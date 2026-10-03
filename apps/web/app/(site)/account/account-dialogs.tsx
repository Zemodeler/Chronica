"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import type { AccountDashboardViewModel } from "@chronica/shared";
import type { LocalAiProvider, LocalAiProviderConfiguration } from "@chronica/ai";
import {
  attachEmail,
  createDeveloperGift,
  redeemGift,
  resumeGame,
  revokeDeveloperGift,
  selectLocalAiProvider,
  signOut,
  updateProfile,
} from "../../actions";
import { DeleteSaveForm } from "../../components/delete-save-form";

const AVATARS = ["laurel", "owl", "lion", "horse", "ship", "tower"] as const;

export type SerializedGift = {
  id: string;
  grantCoins: string;
  state: string;
  codeExpiresAt: string | null;
  createdAt: string;
  redemptionCount: number;
};

type DialogKey = "profile" | "email" | "wallet" | "redeem" | "saves" | "developer" | "ai_provider" | "workflow_proposals" | null;

type Params = {
  gift?: string;
  profile?: string;
  developer?: string;
  email?: string;
  checkout?: string;
  aiProvider?: string;
  status?: string;
};

export function AccountDashboard({
  account,
  gifts,
  params,
  pendingProposalCount = 0,
  localAiProviderConfiguration,
}: {
  account: AccountDashboardViewModel;
  gifts: SerializedGift[];
  params: Params;
  pendingProposalCount?: number;
  localAiProviderConfiguration: LocalAiProviderConfiguration | undefined;
}) {
  const [openDialog, setOpenDialog] = useState<DialogKey>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [displayedCoins, setDisplayedCoins] = useState(account.availableCoins);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/account/coins", { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const data = (await response.json()) as { coins: string | null };
      if (data.coins !== null && !cancelled) setDisplayedCoins(data.coins);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (openDialog !== null) {
      el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [openDialog]);

  const handleDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom
    ) setOpenDialog(null);
  };

  const close = () => setOpenDialog(null);
  const canManageGifts = account.role === "developer" || account.role === "admin";
  const totalSaves = (account.hostedSaves?.length ?? 0) + (account.joinedSaves?.length ?? 0);

  return (
    <>
      <header className="acct-hero">
        <div className="acct-identity">
          <Image
            src={`/avatars/${account.avatarKey}.svg`}
            width={72}
            height={72}
            alt=""
            className="acct-avatar"
          />
          <div>
            <h1 className="acct-name">{account.displayName}</h1>
            {account.username && <p className="acct-username">@{account.username}</p>}
            {account.role !== "user" && (
              <span className="acct-role-badge">{account.role}</span>
            )}
          </div>
        </div>
        <form action={signOut}>
          <button type="submit" className="btn btn--quiet">Sign out</button>
        </form>
      </header>

      {params.profile === "updated" && <p className="notice acct-status">Profile updated.</p>}
      {params.profile === "username_taken" && <p className="error acct-status">That username is already in use.</p>}
      {params.profile && params.profile !== "updated" && params.profile !== "username_taken" && (
        <p className="error acct-status">Check profile fields and try again.</p>
      )}
      {params.gift === "redeemed" && <p className="notice acct-status">Gift redeemed. The new coin lot is in your ledger.</p>}
      {(params.gift === "invalid" || params.gift === "unauthorized") && (
        <p className="error acct-status">This gift code cannot be redeemed.</p>
      )}
      {params.gift === "unavailable" && <p className="error acct-status">Gift codes are temporarily unavailable. Please try again later.</p>}
      {params.developer === "reauth" && <p className="error acct-status">Request a fresh sign-in link before changing gifts.</p>}
      {params.developer === "unavailable" && <p className="error acct-status">Gift-code setup is incomplete. Configure the server secret and try again.</p>}
      {params.developer === "revoked" && <p className="notice acct-status">Gift revoked.</p>}
      {params.aiProvider === "updated" && <p id="ai-provider-status" className="notice acct-status">Local AI provider changed.</p>}
      {(params.aiProvider === "invalid" || params.aiProvider === "unavailable") && <p id="ai-provider-status" className="error acct-status">That local AI provider is not available.</p>}
      {params.aiProvider === "unauthorized" && <p id="ai-provider-status" className="error acct-status">Request a fresh sign-in link before changing the local AI provider.</p>}
      {params.aiProvider === "connection_failed" && <p id="ai-provider-status" className="error acct-status">Could not connect to Codex. Check the sign-in window or server terminal, then try again.</p>}
      {params.email === "sent" && <p className="notice acct-status">Check your inbox for a verification link.</p>}
      {params.email === "invalid" && <p className="error acct-status">We could not send that verification email.</p>}
      {params.status === "deleted" && <p className="notice acct-status">The save and all of its game data were permanently deleted.</p>}

      {/* The wallet leads: it is the one thing here a player comes back for. */}
      <section className="acct-wallet" aria-labelledby="acct-wallet-heading">
        <h2 id="acct-wallet-heading" className="visually-hidden">Your wallet</h2>
        <p className="acct-wallet__sum"><span className="acct-wallet__figure">{displayedCoins}</span> coins in your wallet</p>
        <p className="acct-wallet__note">A coin is one US dollar. Orders, letters and character research are paid from here as they happen.</p>
        <div className="acct-wallet__actions">
          <button type="button" className="btn btn--primary" onClick={() => setOpenDialog("redeem")}>Redeem a gift code</button>
          <button type="button" className="word-button" onClick={() => setOpenDialog("wallet")}>See what was spent</button>
        </div>
      </section>

      <dl className="acct-ledger">
        <div>
          <dt>Name</dt>
          <dd>{account.displayName}{account.username ? <span className="acct-ledger__quiet">, @{account.username}</span> : null}</dd>
          <dd><button type="button" className="word-button" onClick={() => setOpenDialog("profile")}>Edit</button></dd>
        </div>
        <div>
          <dt>Recovery email</dt>
          <dd>{account.emailVerified ? account.email : <span className="acct-ledger__quiet">None yet. Without one, a forgotten password locks you out.</span>}</dd>
          <dd><button type="button" className="word-button" onClick={() => setOpenDialog("email")}>{account.emailVerified ? "Details" : "Add one"}</button></dd>
        </div>
        <div>
          <dt>Saves</dt>
          <dd>{totalSaves === 0 ? <span className="acct-ledger__quiet">None</span> : `${totalSaves} save${totalSaves !== 1 ? "s" : ""}`}</dd>
          <dd><button type="button" className="word-button" onClick={() => setOpenDialog("saves")}>Manage</button></dd>
        </div>
        {canManageGifts && (
          <div className="acct-ledger__dev">
            <dt>Gift codes</dt>
            <dd>{gifts.length} created</dd>
            <dd><button type="button" className="word-button" onClick={() => setOpenDialog("developer")}>Manage</button></dd>
          </div>
        )}
        {canManageGifts && localAiProviderConfiguration?.available && (
          <div className="acct-ledger__dev">
            <dt>Local AI provider</dt>
            <dd>{localAiProviderConfiguration.activeProvider === "codex" ? "Codex allowance" : localAiProviderConfiguration.activeProvider === "openai" ? "OpenAI API" : "Anthropic API"}</dd>
            <dd><button type="button" className="word-button" onClick={() => setOpenDialog("ai_provider")}>Switch</button></dd>
          </div>
        )}
        {canManageGifts && (
          <div className="acct-ledger__dev">
            <dt>Invented workflows</dt>
            <dd>{pendingProposalCount} saved</dd>
            <dd><button type="button" className="word-button" onClick={() => setOpenDialog("workflow_proposals")}>Review</button></dd>
          </div>
        )}
      </dl>

      <dialog
        ref={dialogRef}
        className="account-dialog"
        onClose={close}
        onClick={handleDialogClick}
      >
        {openDialog === "profile" && <ProfileDialog account={account} onClose={close} />}
        {openDialog === "email" && <EmailDialog account={account} onClose={close} />}
        {openDialog === "wallet" && <WalletDialog account={account} displayedCoins={displayedCoins} onClose={close} />}
        {openDialog === "redeem" && <RedeemDialog onClose={close} />}
        {openDialog === "saves" && <SavesDialog account={account} onClose={close} />}
        {openDialog === "developer" && <DeveloperDialog gifts={gifts} onClose={close} />}
        {openDialog === "ai_provider" && localAiProviderConfiguration && <LocalAiProviderDialog configuration={localAiProviderConfiguration} onClose={close} />}
        {openDialog === "workflow_proposals" && <WorkflowProposalsDialog onClose={close} />}
      </dialog>
    </>
  );
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="dialog-header">
      <h2 className="dialog-title">{title}</h2>
      <button type="button" className="dialog-close" onClick={onClose}>Close</button>
    </div>
  );
}

function ProfileDialog({ account, onClose }: { account: AccountDashboardViewModel; onClose: () => void }) {
  return (
    <>
      <DialogHeader title="Edit profile" onClose={onClose} />
      <div className="dialog-body">
        <form action={updateProfile}>
          <label htmlFor="displayName">Display name</label>
          <input id="displayName" name="displayName" defaultValue={account.displayName} minLength={2} maxLength={80} required />
          <label htmlFor="username">Username (optional)</label>
          <input id="username" name="username" defaultValue={account.username ?? ""} pattern="[a-z0-9_]{3,30}" autoComplete="username" />
          <fieldset>
            <legend>Profile picture</legend>
            <div className="avatar-picker">
              {AVATARS.map((avatar) => (
                <label key={avatar}>
                  <input type="radio" name="avatarKey" value={avatar} defaultChecked={account.avatarKey === avatar} />
                  <Image src={`/avatars/${avatar}.svg`} width={56} height={56} alt="" />
                  <span>{avatar}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit">Save Profile</button>
        </form>
      </div>
    </>
  );
}

function EmailDialog({ account, onClose }: { account: AccountDashboardViewModel; onClose: () => void }) {
  return (
    <>
      <DialogHeader title="Recovery email" onClose={onClose} />
      <div className="dialog-body">
        {account.emailVerified ? (
          <p><strong>{account.email}</strong> is verified and can be used to reset your password.</p>
        ) : (
          <>
            <p>Add and verify an email to recover your account if you forget your password. Without it, your account and its saves may be permanently inaccessible.</p>
            <form action={attachEmail}>
              <label htmlFor="emailInput">Email address</label>
              <input id="emailInput" name="email" type="email" autoComplete="email" required maxLength={254} />
              <button type="submit">Add Recovery Email</button>
            </form>
          </>
        )}
      </div>
    </>
  );
}

function WalletDialog({ account, displayedCoins, onClose }: { account: AccountDashboardViewModel; displayedCoins: string; onClose: () => void }) {
  return (
    <>
      <DialogHeader title="Coin wallet" onClose={onClose} />
      <div className="dialog-body">
        <p className="acct-wallet-note">Coins can currently be funded only by a Zemodeler gift code. Purchasing is not available yet.</p>
        <div className="credit-summary">
          <p><strong>{displayedCoins}</strong> available</p>
          <p><strong>{account.heldCoins}</strong> held</p>
          <p><strong>{account.debtCoins}</strong> owed</p>
        </div>
        {account.lots.length > 0 && (
          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table>
              <thead>
                <tr><th>Source</th><th>Remaining</th><th>Held</th><th>Expiry</th></tr>
              </thead>
              <tbody>
                {account.lots.map((lot) => (
                  <tr key={lot.id}>
                    <th scope="row">{lot.sourceLabel}</th>
                    <td>{lot.remainingCoins}</td>
                    <td>{lot.heldCoins}</td>
                    <td>{lot.expiresLabel === "Does not expire" ? lot.expiresLabel : <time dateTime={lot.expiresLabel}>{lot.expiresLabel}</time>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {account.history.length > 0 && (
          <>
            <h3>Coin history</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>When</th><th>Kind</th><th>Amount</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {account.history.map((entry) => (
                    <tr key={entry.id}>
                      <td><time dateTime={entry.whenLabel}>{entry.whenLabel}</time></td>
                      <td>{entry.kind}</td>
                      <td>{entry.amountLabel}</td>
                      <td>{entry.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {account.pausedGames.length > 0 && (
          <>
            <h3>Payment-paused saves</h3>
            {account.pausedGames.map((game) => (
              <form action={resumeGame} key={game.gameId} className="acct-paused-row">
                <input type="hidden" name="gameId" value={game.gameId} />
                <span>{game.title}</span>
                <button type="submit" className="btn btn--primary btn--small">Resume queued work</button>
              </form>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function RedeemDialog({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DialogHeader title="Redeem a gift" onClose={onClose} />
      <div className="dialog-body">
        <p>Enter a gift code to add coins to your wallet.</p>
        <form action={redeemGift}>
          <label htmlFor="code">Gift code</label>
          <input id="code" name="code" autoComplete="off" required placeholder="CHR-..." />
          <button type="submit">Redeem a gift</button>
        </form>
      </div>
    </>
  );
}

function SavesDialog({ account, onClose }: { account: AccountDashboardViewModel; onClose: () => void }) {
  const hostedSaves = account.hostedSaves ?? [];
  const joinedSaves = account.joinedSaves ?? [];
  return (
    <>
      <DialogHeader title="Your saves" onClose={onClose} />
      <div className="dialog-body">
        <h3 style={{ marginTop: 0 }}>Hosted</h3>
        {hostedSaves.length === 0 ? (
          <p>No hosted saves.</p>
        ) : (
          <ul>
            {hostedSaves.map((save) => (
              <li key={save.gameId}>
                <a href={`/games/${save.gameId}`}>{save.title}</a> — {save.status}
                <DeleteSaveForm gameId={save.gameId} title={save.title} returnTo="/account" />
              </li>
            ))}
          </ul>
        )}
        <h3>Joined</h3>
        {joinedSaves.length === 0 ? (
          <p>No joined saves.</p>
        ) : (
          <ul>
            {joinedSaves.map((save) => (
              <li key={save.gameId}><a href={`/games/${save.gameId}`}>{save.title}</a> — {save.status}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function DeveloperDialog({ gifts, onClose }: { gifts: SerializedGift[]; onClose: () => void }) {
  const [expiryLocal, setExpiryLocal] = useState("");
  const [coinExpiryLocal, setCoinExpiryLocal] = useState("");

  const toUtcIso = (v: string) => v ? `${v}:00Z` : "";

  return (
    <>
      <DialogHeader title="Gift codes" onClose={onClose} />
      <div className="dialog-body">
        <h3 style={{ marginTop: 0 }}>Create a new code</h3>
        <form action={createDeveloperGift}>
          <div className="form-grid">
            <div>
              <label htmlFor="grantCoins">Coins per redemption</label>
              <input id="grantCoins" name="grantCoins" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" required placeholder="e.g. 10" />
            </div>
          </div>
          <label htmlFor="codeExpiresAt_picker">Code expiry (optional, UTC)</label>
          <input
            id="codeExpiresAt_picker"
            type="datetime-local"
            value={expiryLocal}
            onChange={(e) => setExpiryLocal(e.target.value)}
          />
          <input type="hidden" name="codeExpiresAt" value={toUtcIso(expiryLocal)} />
          <label htmlFor="grantedCoinsExpireAt_picker">Granted coin expiry (optional, UTC)</label>
          <input
            id="grantedCoinsExpireAt_picker"
            type="datetime-local"
            value={coinExpiryLocal}
            onChange={(e) => setCoinExpiryLocal(e.target.value)}
          />
          <input type="hidden" name="grantedCoinsExpireAt" value={toUtcIso(coinExpiryLocal)} />
          <label htmlFor="auditNote">Audit reason</label>
          <textarea id="auditNote" name="auditNote" minLength={3} maxLength={500} required />
          <button type="submit">Create Gift Code</button>
        </form>

        {gifts.length > 0 && (
          <>
            <h3>Existing codes</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Coins</th>
                    <th>Use</th>
                    <th>Expires</th>
                    <th>State</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {gifts.map((gift) => (
                    <tr key={gift.id}>
                      <td>{gift.createdAt.slice(0, 10)}</td>
                      <td>{gift.grantCoins}</td>
                      <td>{gift.redemptionCount === 0 ? "Unused" : "Used"}</td>
                      <td>{gift.codeExpiresAt ? gift.codeExpiresAt.slice(0, 16).replace("T", " ") : "Never"}</td>
                      <td>{gift.state}</td>
                      <td>
                        {gift.state === "active" && (
                          <form action={revokeDeveloperGift}>
                            <input type="hidden" name="giftCodeId" value={gift.id} />
                            <input type="hidden" name="auditReason" value="Revoked via dashboard" />
                            <button type="submit" className="btn btn--danger btn--small">Revoke</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function LocalAiProviderDialog({ configuration, onClose }: { configuration: LocalAiProviderConfiguration; onClose: () => void }) {
  const [provider, setProvider] = useState(configuration.activeProvider);
  const providerModels = (value: LocalAiProvider) => value === "codex" ? configuration.codexModels : value === "openai" ? configuration.openAiModels : configuration.anthropicModels;
  const models = providerModels(provider);
  const [model, setModel] = useState(configuration.activeModel);

  const changeProvider = (nextProvider: LocalAiProvider) => {
    const nextModels = providerModels(nextProvider);
    setProvider(nextProvider);
    setModel(nextModels[0] ?? "");
  };

  return (
    <>
      <DialogHeader title="Local AI provider" onClose={onClose} />
      <div className="dialog-body">
        <p className="dialog-lede">
          Choose the AI used by every game on this local development server. Codex uses your ChatGPT allowance. API keys stay in your local environment file.
        </p>
        <form action={selectLocalAiProvider}>
          <fieldset>
            <legend>Provider</legend>
            <label>
              <input type="radio" name="provider" value="codex" checked={provider === "codex"} onChange={() => changeProvider("codex")} />
              Codex allowance
            </label>
            <label>
              <input type="radio" name="provider" value="openai" checked={provider === "openai"} onChange={() => changeProvider("openai")} disabled={!configuration.openAiConfigured} />
              OpenAI API{!configuration.openAiConfigured && " (key not configured)"}
            </label>
            <label>
              <input type="radio" name="provider" value="anthropic" checked={provider === "anthropic"} onChange={() => changeProvider("anthropic")} disabled={!configuration.anthropicConfigured} />
              Anthropic API{!configuration.anthropicConfigured && " (key not configured)"}
            </label>
          </fieldset>
          {provider === "codex" && <p>Codex installs automatically. Your existing CLI sign-in is reused, or a ChatGPT sign-in window opens. No API key is needed.</p>}
          <label htmlFor="local-ai-model">Model</label>
          <select id="local-ai-model" name="model" value={models.includes(model) ? model : models[0] ?? ""} onChange={(event) => setModel(event.target.value)}>
            {models.map((availableModel) => <option key={availableModel} value={availableModel}>{availableModel}</option>)}
          </select>
          <AiProviderSubmit />
        </form>
      </div>
    </>
  );
}

function AiProviderSubmit() {
  const { pending, data } = useFormStatus();
  const connecting = pending && data?.get("provider") === "codex";
  return <>
    <button type="submit" disabled={pending}>{connecting ? "Connecting to Codex…" : pending ? "Saving…" : "Use selected provider"}</button>
    {connecting && <p role="status">Preparing Codex. Complete ChatGPT sign-in if a window opens; this page will update when ready.</p>}
  </>;
}

type InventedWorkflowRow = {
  id: string;
  gameId: string;
  createdTurnId: string;
  actionId: string;
  intent: string;
  description: string;
  definition: unknown;
  status: "active" | "disabled";
  successfulUseCount: number;
  lastUsedAt: string | null;
  createdAt: string;
};

function WorkflowProposalsDialog({ onClose }: { onClose: () => void }) {
  const [workflows, setWorkflows] = useState<InventedWorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<Record<string, boolean>>({});
  const [useHistory, setUseHistory] = useState<Record<string, unknown[]>>({});

  useEffect(() => {
    void fetch("/api/admin/invented-workflows?limit=50")
      .then((r) => r.json() as Promise<{ workflows: InventedWorkflowRow[] }>)
      .then((data) => { setWorkflows(data.workflows); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const setStatus = async (id: string, status: "active" | "disabled") => {
    setWorking((w) => ({ ...w, [id]: true }));
    try {
      await fetch(`/api/admin/invented-workflows/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: reviewNote[id] ?? "" }),
      });
      setWorkflows((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    } finally {
      setWorking((w) => ({ ...w, [id]: false }));
    }
  };

  const viewUseHistory = async (id: string) => {
    const response = await fetch(`/api/admin/invented-workflows/${id}`);
    const data = await response.json() as { uses?: unknown[] };
    setUseHistory((history) => ({ ...history, [id]: data.uses ?? [] }));
  };

  return (
    <>
      <DialogHeader title="Invented workflows" onClose={onClose} />
      <div className="dialog-body">
        <p className="dialog-lede">
          Reusable AI-created game workflows, ranked by successful use. Disabling one removes it from future AI decisions without changing past turns.
        </p>

        {loading && <p>Loading…</p>}

        {!loading && workflows.length === 0 && (
          <p className="dialog-empty">No invented workflows yet.</p>
        )}

        {workflows.map((workflow) => (
          <div key={workflow.id} style={{ borderTop: "1px solid var(--rule)", paddingTop: "1rem", marginTop: "1rem" }}>
            <p><strong>{workflow.actionId}</strong> is {workflow.status}, with {workflow.successfulUseCount} successful use{workflow.successfulUseCount === 1 ? "" : "s"}.</p>
            <p><strong>Intent:</strong> {workflow.intent}</p>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--step-0)" }}>
              {workflow.description} In game <code>{workflow.gameId.slice(0, 8)}</code>, last used {workflow.lastUsedAt ? new Date(workflow.lastUsedAt).toLocaleString() : "never"}.
            </p>
            {useHistory[workflow.id] && (
              <pre style={{ fontSize: "var(--step--1)", overflowX: "auto", background: "var(--papyrus-shade)", padding: "0.5rem", borderRadius: "4px" }}>
                {JSON.stringify({ definition: workflow.definition, recentUses: useHistory[workflow.id] }, null, 2)}
              </pre>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              <button type="button" className="btn btn--quiet btn--small" onClick={() => void viewUseHistory(workflow.id)}>
                View definition & uses
              </button>
              <input
                type="text"
                placeholder="Review note (optional)"
                value={reviewNote[workflow.id] ?? ""}
                onChange={(e) => setReviewNote((n) => ({ ...n, [workflow.id]: e.target.value }))}
                className="input sm"
                style={{ flex: 1, minWidth: "180px" }}
              />
              <button
                type="button"
                className="btn btn--quiet btn--small"
                disabled={working[workflow.id] || workflow.status === "active"}
                onClick={() => void setStatus(workflow.id, "active")}
              >
                Enable
              </button>
              <button
                type="button"
                className="btn btn--quiet btn--small"
                disabled={working[workflow.id] || workflow.status === "disabled"}
                onClick={() => void setStatus(workflow.id, "disabled")}
              >
                Disable
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
