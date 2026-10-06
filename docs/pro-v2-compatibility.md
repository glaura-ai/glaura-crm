# Pro V2 onboarding compatibility

This change preserves `essentiel_v2`, `solo_v2` and `salon_v2` from the trusted
portal request through CRM jobs, previews, checkout offers and activation.
V2 trial days remain zero. Historical Basic and Reservation trial behavior is
unchanged. Unknown plans and commitment identities fail validation.

V2 requests require a payment-gated activation preview for an existing portal
UID. The resulting salon stays disabled until the existing activation endpoint
verifies an active/trialing Stripe subscription in the expected mode with the
exact selected plan identity. Preview generation never grants paid access.

This compatibility PR does not enable or configure the Firebase Pro V2 catalog,
create Stripe prices, migrate subscribers or deploy services. Integrate through
`develop`; release only with explicit authorization and after backend, portal,
website and analytics contracts are validated together. The `_commitment`
identities represent twelve monthly payments at €14.90 / €39 / €65 with a
minimum twelve-month term; they are preserved exactly, never rewritten to a
flexible plan. Acceptance happens at checkout through the portal/backend, not
at signup or preview generation. Old `_yearly` identities remain blocked.
Website purchase remains disabled pending its commercial terms.
