# Embedded Child App Requirements

Apply these changes in both external SaaS repos:

- Lead Scraper: `https://lead-scraper-six-wine.vercel.app/dashboard`
- WhatsApp Campaign: `https://whatsapp-compaign-alpha.vercel.app/dashboard`

## Embed Detection

Add dashboard-layout detection:

```ts
const isEmbedded =
  typeof window !== "undefined" &&
  (window.self !== window.top ||
    new URLSearchParams(window.location.search).get("embed") === "true");
```

When `isEmbedded` is true:

- Hide sidebar, topbar/navbar, duplicate logos, and duplicated layout chrome.
- Remove outer dashboard padding.
- Render only the dashboard content.
- Prefer a single page-level scroll container so the parent iframe does not create nested scrollbars.

## Frame Ancestors

Set this header in each child app through `next.config.*` headers or middleware:

```txt
Content-Security-Policy: frame-ancestors 'self' http://localhost:3000 <production-parent-origins>;
```

Use an environment variable for production origins, for example `PARENT_FRAME_ANCESTORS`.

Do not send `X-Frame-Options: DENY` or `X-Frame-Options: SAMEORIGIN`, because either one can block the parent dashboard iframe.

## Cross-Site Auth

If the child app uses cookies for auth inside the iframe, cookies must be set with:

```txt
SameSite=None; Secure
```
