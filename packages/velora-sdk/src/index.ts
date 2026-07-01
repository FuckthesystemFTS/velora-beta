export type VeloraIdentityLevel = 0 | 1 | 2 | 3;

export type NotYetAvailable = {
  available: false;
  status: "NOT_YET_AVAILABLE";
  reason: string;
};

export type VeloraSession = {
  available: true;
  userId: string;
  token?: string;
  identityLevel: VeloraIdentityLevel;
  scopes: string[];
};

export type VeloraClaims = {
  available: true;
  verifiedEmail: boolean;
  verifiedDocument: boolean;
  level: VeloraIdentityLevel;
  scopes: string[];
};

export type VeloraCapability = NotYetAvailable | {
  available: true;
  status: "AVAILABLE";
  capabilities: string[];
};

export type VeloraConsentResult = NotYetAvailable | {
  available: true;
  grantedScopes: string[];
};

export type VeloraOtpChallenge = NotYetAvailable | {
  available: true;
  challengeId: string;
  expiresInSeconds: number;
};

export type VeloraOtpConfirmation = NotYetAvailable | {
  available: true;
  confirmed: boolean;
};

export type VeloraSdkOptions = {
  sessionProvider?: () => Promise<VeloraSession | undefined> | VeloraSession | undefined;
  apiBaseUrl?: string;
};

export type VeloMailMessage = {
  id: string;
  messageId: string;
  folder: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  bodyPreview: string;
  deliveryStatus: string;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
};

export type VeloMailAccount = {
  id: string;
  alias: string;
  address: string;
  status: string;
  identityLevel: number;
};

function unavailable(reason: string): NotYetAvailable {
  return { available: false, status: "NOT_YET_AVAILABLE", reason };
}

async function resolveSession(options?: VeloraSdkOptions) {
  return options?.sessionProvider ? await options.sessionProvider() : undefined;
}

async function mailRequest<T>(options: VeloraSdkOptions | undefined, path: string, init?: RequestInit): Promise<T | NotYetAvailable> {
  const session = await resolveSession(options);
  if (!session) {
    return unavailable("VeloMail richiede una sessione Velora.");
  }
  if (!options?.apiBaseUrl) {
    return unavailable("Host API Velora non configurato.");
  }
  if (!session.token) {
    return unavailable("Token sessione Velora non disponibile.");
  }
  const response = await fetch(`${options.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`VELOMAIL_API_ERROR_${response.status}`);
  }
  return await response.json() as T;
}

export function createVelora(options?: VeloraSdkOptions) {
  return {
    auth: {
      async getSession() {
        return await resolveSession(options) ?? unavailable("Login Velora non disponibile in questo contesto.");
      },
      async requireLevel(level: VeloraIdentityLevel) {
        const session = await resolveSession(options);
        if (!session) {
          return unavailable("Sessione Velora assente.");
        }
        return {
          available: session.identityLevel >= level,
          requiredLevel: level,
          currentLevel: session.identityLevel
        };
      },
      async logout() {
        return unavailable("Logout gestito dal client Velora host.");
      }
    },
    identity: {
      async getClaims(): Promise<VeloraClaims | NotYetAvailable> {
        const session = await resolveSession(options);
        if (!session) {
          return unavailable("Claims identita non disponibili senza sessione.");
        }
        return {
          available: true,
          verifiedEmail: session.identityLevel >= 1,
          verifiedDocument: session.identityLevel >= 2,
          level: session.identityLevel,
          scopes: session.scopes
        };
      },
      async hasVerifiedEmail() {
        const session = await resolveSession(options);
        return Boolean(session && session.identityLevel >= 1);
      },
      async hasVerifiedDocument() {
        const session = await resolveSession(options);
        return Boolean(session && session.identityLevel >= 2);
      },
      async requestConsent(_scopes: string[]): Promise<VeloraConsentResult> {
        return unavailable("Consent UI sara fornita dal client Velora.");
      }
    },
    security: {
      async requestOtpChallenge(): Promise<VeloraOtpChallenge> {
        return unavailable("OTP non ancora disponibile nella beta pubblica.");
      },
      async confirmOtpChallenge(): Promise<VeloraOtpConfirmation> {
        return unavailable("Conferma OTP non ancora disponibile nella beta pubblica.");
      }
    },
    payments: {
      async getCapabilities(): Promise<VeloraCapability> {
        return unavailable("Pagamenti reali non abilitati in beta.");
      },
      async requestAuthorization(): Promise<VeloraCapability> {
        return unavailable("Autorizzazione pagamento non abilitata in beta.");
      }
    },
    wallet: {
      async getCapabilities(): Promise<VeloraCapability> {
        return unavailable("Wallet Velora predisposto ma non operativo in beta.");
      }
    },
    mail: {
      async getAccount(): Promise<VeloMailAccount | NotYetAvailable> {
        return mailRequest<VeloMailAccount>(options, "/api/v1/mail/account");
      },
      async getInbox(): Promise<{ messages: VeloMailMessage[] } | NotYetAvailable> {
        return mailRequest<{ messages: VeloMailMessage[] }>(options, "/api/v1/mail/inbox");
      },
      async getMessage(messageId: string): Promise<VeloMailMessage | NotYetAvailable> {
        return mailRequest<VeloMailMessage>(options, `/api/v1/mail/messages/${encodeURIComponent(messageId)}`);
      },
      async compose(input: { to: string[]; subject: string; body: string }) {
        return { available: true as const, draft: input };
      },
      async send(input: { to: string[]; subject: string; body: string }): Promise<VeloMailMessage | NotYetAvailable> {
        validateMailInput(input);
        return mailRequest<VeloMailMessage>(options, "/api/v1/mail/send", { method: "POST", body: JSON.stringify(input) });
      },
      async reply(input: { messageId: string; body: string }): Promise<NotYetAvailable> {
        return unavailable(`Risposta diretta predisposta ma non ancora operativa. Message: ${input.messageId}`);
      },
      async forward(input: { messageId: string; to: string[]; body?: string }): Promise<NotYetAvailable> {
        return unavailable(`Inoltro predisposto ma non ancora operativo. Message: ${input.messageId}`);
      },
      async saveDraft(input: { to: string[]; subject: string; body?: string }): Promise<VeloMailMessage | NotYetAvailable> {
        return mailRequest<VeloMailMessage>(options, "/api/v1/mail/drafts", { method: "POST", body: JSON.stringify(input) });
      },
      async delete(messageId: string): Promise<VeloMailMessage | NotYetAvailable> {
        return mailRequest<VeloMailMessage>(options, `/api/v1/mail/messages/${encodeURIComponent(messageId)}/delete`, { method: "POST" });
      },
      async archive(messageId: string): Promise<VeloMailMessage | NotYetAvailable> {
        return mailRequest<VeloMailMessage>(options, `/api/v1/mail/messages/${encodeURIComponent(messageId)}/archive`, { method: "POST" });
      },
      async markRead(messageId: string): Promise<VeloMailMessage | NotYetAvailable> {
        return mailRequest<VeloMailMessage>(options, `/api/v1/mail/messages/${encodeURIComponent(messageId)}/read`, { method: "POST" });
      },
      async markUnread(messageId: string): Promise<VeloMailMessage | NotYetAvailable> {
        return mailRequest<VeloMailMessage>(options, `/api/v1/mail/messages/${encodeURIComponent(messageId)}/unread`, { method: "POST" });
      },
      async star(messageId: string): Promise<VeloMailMessage | NotYetAvailable> {
        return mailRequest<VeloMailMessage>(options, `/api/v1/mail/messages/${encodeURIComponent(messageId)}/star`, { method: "POST" });
      },
      async blockSender(senderAddress: string): Promise<{ blocked: true; senderAddress: string } | NotYetAvailable> {
        return mailRequest<{ blocked: true; senderAddress: string }>(options, "/api/v1/mail/block-sender", { method: "POST", body: JSON.stringify({ senderAddress }) });
      },
      async reportSpam(messageId: string, reason = "USER_REPORT"): Promise<{ reported: true } | NotYetAvailable> {
        return mailRequest<{ reported: true }>(options, `/api/v1/mail/messages/${encodeURIComponent(messageId)}/report-spam`, { method: "POST", body: JSON.stringify({ reason }) });
      },
      async search(query: string): Promise<{ messages: VeloMailMessage[] } | NotYetAvailable> {
        return mailRequest<{ messages: VeloMailMessage[] }>(options, `/api/v1/mail/search?q=${encodeURIComponent(query)}`);
      },
      async getSyncStatus() {
        return mailRequest<Record<string, unknown>>(options, "/api/v1/mail/sync-status");
      }
    }
  };
}

export const Velora = createVelora();

function validateMailInput(input: { to: string[]; subject: string; body: string }) {
  if (!Array.isArray(input.to) || input.to.length === 0) {
    throw new Error("VELOMAIL_RECIPIENT_REQUIRED");
  }
  if (!input.subject.trim()) {
    throw new Error("VELOMAIL_SUBJECT_REQUIRED");
  }
  if (!input.body.trim()) {
    throw new Error("VELOMAIL_BODY_REQUIRED");
  }
}
