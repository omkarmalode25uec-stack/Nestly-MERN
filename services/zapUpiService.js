/**
 * ZAP UPI Gateway Service
 * 
 * Secure server-side service for communicating with the ZapUPI payment gateway.
 * Complies strictly with Nestly security rules:
 * - Never logs or exposes API keys
 * - Accesses sensitive credentials exclusively from process.env
 * - Implements documented ZapUPI endpoints:
 *   1. Create Order: POST /api/create-order
 *   2. Order Status: POST /api/order-status
 */

const ZAP_GATEWAY_URL = process.env.ZAP_UPI_BASE_URL || 'https://pay.zapupi.com';

class ZapUpiService {
  /**
   * Check whether a real ZAP UPI API key is configured.
   */
  static isConfigured() {
    const key = process.env.ZAP_UPI_API_KEY;
    if (!key) return false;
    const trimmed = String(key).trim();
    const isPlaceholder = !trimmed ||
      trimmed === 'YOUR_ZAP_UPI_API_KEY' ||
      trimmed === 'YOUR_NEW_ZAP_API_KEY' ||
      trimmed.startsWith('YOUR_');
    if (isPlaceholder) return false;

    // Unit test bypass
    if (process.env.NODE_ENV === 'test' && !process.env.ZAP_UPI_TEST_REAL) {
      return false;
    }

    // In production, valid keys are always active.
    // In non-production, allow explicit simulation flag to route locally.
    if (process.env.NODE_ENV !== 'production' && process.env.ZAP_UPI_SIMULATION === 'true') {
      return false;
    }

    return true;
  }

  /**
   * Validate incoming webhook source against configured ZapUPI gateway server IP.
   */
  static isValidGatewayIp(remoteIp) {
    const gatewayIp = process.env.ZAP_UPI_SERVER_GATEWAY_IP || '72.61.225.127';
    if (!remoteIp) return false;
    if (process.env.ZAP_UPI_SIMULATION === 'true' || process.env.NODE_ENV !== 'production') {
      return true;
    }
    return remoteIp.includes(gatewayIp) || remoteIp === '127.0.0.1' || remoteIp === '::1';
  }

  /**
   * Initiate a payment order with ZapUPI gateway.
   * 
   * @param {Object} params
   * @param {string} params.orderId - Unique order reference ID
   * @param {number|string} params.amount - Payable amount in INR
   * @param {string} params.customerMobile - Student phone number
   * @param {string} params.remark - Transaction notes (e.g. Nestly First Month Rent)
   * @param {string} params.webhookUrl - Callback URL for payment updates
   * @param {string} params.redirectUrl - Return redirect URL
   * @param {string} params.successUrl - Redirect URL on success
   * @param {string} params.failedUrl - Redirect URL on failure
   * @param {string} params.timeoutUrl - Redirect URL on timeout
   * @returns {Promise<Object>}
   */
  static async createOrder({
    orderId,
    amount,
    customerMobile,
    remark,
    webhookUrl,
    redirectUrl,
    successUrl,
    failedUrl,
    timeoutUrl
  }) {
    const zapKey = process.env.ZAP_UPI_API_KEY;

    // ZapUPI gateway requires a valid merchant API key (zap_key)
    if (!this.isConfigured()) {
      return {
        success: false,
        orderId,
        amount,
        error: 'ZapUPI Merchant API Key is not configured. Please set a valid ZAP_UPI_API_KEY in your Render dashboard / environment variables to enable the hosted checkout gateway.'
      };
    }

    // Sanitize remark (ZapUPI rejects pipes, hashes, and special characters)
    const cleanRemark = String(remark || 'NestlyFirstMonthRent').replace(/[^a-zA-Z0-9 ]/g, '').trim().substring(0, 50) || 'NestlyFirstMonthRent';

    const payload = {
      zap_key: zapKey,
      order_id: String(orderId),
      amount: String(amount),
      customer_mobile: String(customerMobile || ''),
      remark: cleanRemark,
      webhook_url: String(webhookUrl || '')
    };

    if (redirectUrl) payload.redirect_url = String(redirectUrl);
    if (successUrl) payload.success_url = String(successUrl);
    if (failedUrl) payload.failed_url = String(failedUrl);
    if (timeoutUrl) payload.timeout_url = String(timeoutUrl);

    try {
      const response = await fetch(`${ZAP_GATEWAY_URL}/api/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      const data = await response.json();
      const resData = (data && typeof data.data === 'object' && data.data !== null) ? data.data : (data?.order || data || {});
      const status = String(data?.status || resData?.status || '').toLowerCase();
      const paymentUrl = resData?.payment_url || data?.payment_url || resData?.paymentUrl || data?.paymentUrl || resData?.checkout_url || data?.checkout_url;
      const payId = resData?.pay_id || data?.pay_id;

      // When ZapUPI successfully returns a live payment checkout URL
      if (paymentUrl && (paymentUrl.startsWith('http://') || paymentUrl.startsWith('https://'))) {
        return {
          success: true,
          orderId,
          amount,
          paymentUrl,
          payId: payId || null,
          raw: data
        };
      }

      // If gateway returns status success/true with a relative URL or identifier
      if ((status === 'success' || status === 'true' || status === '1') && paymentUrl) {
        return {
          success: true,
          orderId,
          amount,
          paymentUrl,
          payId: payId || null,
          raw: data
        };
      }

      // If gateway rejected the order creation or returned an error
      const errorMsg = data?.message || data?.msg || resData?.message || 'ZapUPI gateway could not generate checkout URL';
      console.error('[ZapUPI createOrder] Gateway rejected order creation:', errorMsg, data);
      return {
        success: false,
        orderId,
        amount,
        error: errorMsg,
        raw: data
      };
    } catch (err) {
      console.error('[ZapUPI createOrder] Network/fetch error:', err.message);
      return {
        success: false,
        orderId,
        amount,
        error: `ZapUPI gateway unreachable: ${err.message}`
      };
    }
  }

  /**
   * Normalize any gateway status string to standard Nestly status:
   * 'success' | 'failed' | 'timeout' | 'pending'
   */
  static normalizeStatus(rawStatus) {
    if (rawStatus === true || rawStatus === 1) return 'success';
    if (rawStatus === false || rawStatus === 0) return 'failed';
    if (!rawStatus) return 'pending';
    const s = String(rawStatus).toLowerCase().trim();
    if (
      s === 'success' ||
      s === 'completed' ||
      s === 'captured' ||
      s === 'paid' ||
      s === 'successful' ||
      s === 'txn_success' ||
      s === 'order_success' ||
      s === 'ok' ||
      s === 'true' ||
      s === '1'
    ) {
      return 'success';
    }
    if (s === 'timeout' || s === 'expired' || s === 'time_out' || s === 'timed_out') {
      return 'timeout';
    }
    if (
      s === 'failed' ||
      s === 'failure' ||
      s === 'rejected' ||
      s === 'cancelled' ||
      s === 'canceled' ||
      s === 'declined' ||
      s === 'txn_failure' ||
      s === 'false' ||
      s === '0'
    ) {
      return 'failed';
    }
    if (
      s === 'pending' ||
      s === 'initiated' ||
      s === 'processing' ||
      s === 'awaiting' ||
      s === 'submitted'
    ) {
      return 'pending';
    }
    return s;
  }

  /**
   * Verify an order's status directly with ZapUPI server.
   * 
   * @param {string} orderId - Unique order identifier
   * @returns {Promise<Object>}
   */
  static async verifyOrderStatus(orderId) {
    const zapKey = process.env.ZAP_UPI_API_KEY;

    if (!this.isConfigured()) {
      return {
        success: false,
        status: 'Pending',
        normalizedStatus: 'pending',
        orderId,
        message: 'Payment gateway awaiting transaction settlement'
      };
    }

    const payload = {
      zap_key: zapKey,
      order_id: String(orderId)
    };

    try {
      const response = await fetch(`${ZAP_GATEWAY_URL}/api/order-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      const data = await response.json();
      const inner = (data && typeof data.data === 'object' && data.data !== null) ? data.data : (data?.order || data || {});

      // Candidates in priority order
      const candidateStatuses = [
        inner.order_status,
        inner.status,
        inner.txn_status,
        inner.payment_status,
        data?.order_status,
        data?.status,
        data?.txn_status
      ];

      let rawStatus = '';
      let normalizedStatus = 'pending';

      for (const candidate of candidateStatuses) {
        if (candidate !== undefined && candidate !== null && candidate !== '') {
          const norm = this.normalizeStatus(candidate);
          if (norm === 'success' || norm === 'failed' || norm === 'timeout') {
            rawStatus = candidate;
            normalizedStatus = norm;
            break;
          }
          if (!rawStatus) rawStatus = candidate;
        }
      }

      const isSuccess = normalizedStatus === 'success';
      const amount = inner.amount || inner.pay_amount || data?.amount || data?.pay_amount || null;
      const txnId = inner.txn_id || inner.txnId || inner.transaction_id || data?.txn_id || data?.txnId || null;
      const utr = inner.utr || inner.bank_utr || inner.bank_rrn || data?.utr || data?.bank_utr || null;

      return {
        success: isSuccess,
        status: rawStatus || normalizedStatus,
        normalizedStatus,
        amount,
        txnId,
        utr,
        raw: data
      };
    } catch (err) {
      console.warn('[ZAP UPI] Verification gateway query issue:', err.message);
      return {
        success: false,
        status: 'Unreachable',
        normalizedStatus: 'pending',
        orderId,
        error: err.message
      };
    }
  }
}

module.exports = ZapUpiService;
