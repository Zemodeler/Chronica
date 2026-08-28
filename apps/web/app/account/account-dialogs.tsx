"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { AccountDashboardViewModel } from "@chronica/shared";
import {
  attachEmail,
  createDeveloperGift,
  redeemGift,
  resumeGame,
  revokeDeveloperGift,
  signOut,
  updateProfile,
} from "../actions";

const AVATARS = ["laurel", "owl", "lion", "horse", "ship", "tower"] as const;

export type SerializedGift = {
  id: string;
  grantCoins: string;
  maxRedemptions: number;
  state: string;
  codeExpiresAt: string | null;
  createdAt: string;
  redemptionCount: number;
};

type DialogKey = "profile" | "email" | "wallet" | "redeem" | "saves" | "developer" | null;

type Params = {
  gift?: string;
  profile?: string;
  developer?: string;
  email?: string;
  checkout?: string;
};

export function AccountDashboard({
  account,
  gifts,
  params,
}: {
  account: AccountDashboardViewModel;
  gifts: SerializedGift[];
  params: Params;
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
          <button type="submit" className="button secondary">Sign out</button>
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
      {params.developer === "reauth" && <p className="error acct-status">Request a fresh sign-in link before changing gifts.</p>}
      {params.developer === "revoked" && <p className="notice acct-status">Gift revoked.</p>}
      {params.email === "sent" && <p className="notice acct-status">Check your inbox for a verification link.</p>}
      {params.email === "invalid" && <p className="error acct-status">We could not send that verification email.</p>}

      <div className="account-grid">
        <button type="button" className="account-card" onClick={() => setOpenDialog("profile")}>
          <span className="account-card-icon">🧑</span>
          <span className="account-card-title">Profile</span>
          <span className="account-card-meta">
            {account.displayName}{account.username ? ` · @${account.username}` : ""}
          </span>
          <span className="account-card-action">Edit →</span>
        </button>

        <button type="button" className="account-card" onClick={() => setOpenDialog("wallet")}>
          <span className="account-card-icon">🪙</span>
          <span className="account-card-title">Coin Wallet</span>
          <span className="account-card-value">{displayedCoins}</span>
          <span className="account-card-action">View →</span>
        </button>

        <button type="button" className="account-card" onClick={() => setOpenDialog("redeem")}>
          <span className="account-card-icon">🎁</span>
          <span className="account-card-title">Redeem Gift</span>
          <span className="account-card-meta">Enter a gift code to receive coins</span>
          <span className="account-card-action">Redeem →</span>
        </button>

        <button type="button" className="account-card" onClick={() => setOpenDialog("saves")}>
          <span className="account-card-icon">💾</span>
          <span className="account-card-title">Your Saves</span>
          <span className="account-card-meta">
            {totalSaves} save{totalSaves !== 1 ? "s" : ""}
          </span>
          <span className="account-card-action">Manage →</span>
        </button>

        <button type="button" className="account-card" onClick={() => setOpenDialog("email")}>
          <span className="account-card-icon">✉️</span>
          <span className="account-card-title">Recovery Email</span>
          <span className="account-card-meta">
            {account.emailVerified ? `Verified: ${account.email}` : "No recovery email set"}
          </span>
          <span className="account-card-action">{account.emailVerified ? "Info →" : "Add →"}</span>
        </button>

        {canManageGifts && (
          <button type="button" className="account-card account-card--dev" onClick={() => setOpenDialog("developer")}>
            <span className="account-card-icon">🔑</span>
            <span className="account-card-title">Gift Codes</span>
            <span className="account-card-meta">
              {gifts.length} code{gifts.length !== 1 ? "s" : ""} created
            </span>
            <span className="account-card-action">Manage →</span>
          </button>
        )}
      </div>

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
      </dialog>
    </>
  );
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="dialog-header">
      <h2 className="dialog-title">{title}</h2>
      <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
    </div>
  );
}

function ProfileDialog({ account, onClose }: { account: AccountDashboardViewModel; onClose: () => void }) {
  return (
    <>
      <DialogHeader title="Edit Profile" onClose={onClose} />
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
      <DialogHeader title="Recovery Email" onClose={onClose} />
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
      <DialogHeader title="Coin Wallet" onClose={onClose} />
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
                <button type="submit" className="button sm">Resume queued work</button>
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
      <DialogHeader title="Redeem a Gift" onClose={onClose} />
      <div className="dialog-body">
        <p>Enter a gift code to add coins to your wallet.</p>
        <form action={redeemGift}>
          <label htmlFor="code">Gift code</label>
          <input id="code" name="code" autoComplete="off" required placeholder="CHR-..." />
          <button type="submit">Redeem Gift</button>
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
      <DialogHeader title="Your Saves" onClose={onClose} />
      <div className="dialog-body">
        <h3 style={{ marginTop: 0 }}>Hosted</h3>
        {hostedSaves.length === 0 ? (
          <p>No hosted saves.</p>
        ) : (
          <ul>
            {hostedSaves.map((save) => (
              <li key={save.gameId}><a href={`/games/${save.gameId}`}>{save.title}</a> — {save.status}</li>
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
      <DialogHeader title="Gift Codes" onClose={onClose} />
      <div className="dialog-body">
        <h3 style={{ marginTop: 0 }}>Create a new code</h3>
        <form action={createDeveloperGift}>
          <div className="form-grid">
            <div>
              <label htmlFor="grantCoins">Coins per redemption</label>
              <input id="grantCoins" name="grantCoins" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" required placeholder="e.g. 10" />
            </div>
            <div>
              <label htmlFor="maxRedemptions">Max redemptions</label>
              <input id="maxRedemptions" name="maxRedemptions" type="number" min="1" max="100000" defaultValue="1" required />
            </div>
            <div>
              <label htmlFor="perAccountLimit">Per-account limit</label>
              <input id="perAccountLimit" name="perAccountLimit" type="number" min="1" max="100" defaultValue="1" required />
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
                    <th>Uses</th>
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
                      <td>{gift.redemptionCount}/{gift.maxRedemptions}</td>
                      <td>{gift.codeExpiresAt ? gift.codeExpiresAt.slice(0, 16).replace("T", " ") : "Never"}</td>
                      <td>{gift.state}</td>
                      <td>
                        {gift.state === "active" && (
                          <form action={revokeDeveloperGift}>
                            <input type="hidden" name="giftCodeId" value={gift.id} />
                            <input type="hidden" name="auditReason" value="Revoked via dashboard" />
                            <button type="submit" className="button sm">Revoke</button>
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
