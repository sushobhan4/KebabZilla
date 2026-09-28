import { API_BASE } from './api'

type Checkout = {
  gateway_order_id: string
  amount: number
  currency: string
  key_id: string
  name: string
  description: string
  prefill: { name: string; email: string; contact: string }
}
type RazorpayResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

async function loadCheckout() {
  if (window.Razorpay) return true
  return new Promise<boolean>((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve(Boolean(window.Razorpay))
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export async function launchCheckout(checkout: Checkout, handlers: {
  onPaid: (payment: RazorpayResult) => Promise<void>
  onDismiss: () => void
  onError: (error: Error) => void
}) {
  if (!await loadCheckout() || !window.Razorpay) throw new Error('Secure checkout could not load. Refresh and try again.')
  await new Promise<void>((resolve) => {
    let finished = false
    const finish = () => { if (!finished) { finished = true; resolve() } }
    const checkoutWindow = new window.Razorpay!({
      key: checkout.key_id,
      amount: checkout.amount,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      order_id: checkout.gateway_order_id,
      prefill: checkout.prefill,
      theme: { color: '#c34226' },
      handler: async (payment: RazorpayResult) => {
        try { await handlers.onPaid(payment) }
        catch (error) { handlers.onError(error instanceof Error ? error : new Error('Payment verification could not be completed.')) }
        finally { finish() }
      },
      modal: { ondismiss: () => { handlers.onDismiss(); finish() } },
    })
    checkoutWindow.open()
  })
}

export async function verifyRazorpayPayment(payment: RazorpayResult) {
  const response = await fetch(`${API_BASE}/payments/razorpay/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('kz_access_token') || ''}` },
    body: JSON.stringify({
      gateway_order_id: payment.razorpay_order_id,
      gateway_payment_id: payment.razorpay_payment_id,
      signature: payment.razorpay_signature,
    }),
  })
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(problem?.detail || 'Payment could not be verified yet. Contact the restaurant with your order number.')
  }
}
