# Velora SDK

SDK iniziale per siti nativi Velora.

```ts
import { Velora } from "@velora/sdk";

const session = await Velora.auth.getSession();
const claims = await Velora.identity.getClaims();
```

Le funzioni non operative in beta restituiscono:

```ts
{ available: false, status: "NOT_YET_AVAILABLE" }
```

## React

```tsx
import { createVelora } from "@velora/sdk";

const Velora = createVelora({
  sessionProvider: () => window.velora?.session
});
```

## JavaScript

```js
import { Velora } from "@velora/sdk";

const capabilities = await Velora.payments.getCapabilities();
```

## Changelog

- `0.1.0`: API iniziali per auth, identity, security, payments e wallet.
