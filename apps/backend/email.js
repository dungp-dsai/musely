// Transactional email via Resend (https://resend.com).
// Uses the native fetch client — no extra dependency required (Node 22+).

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// "Musely <support@musely.tech>" — the verified sending identity.
const FROM = process.env.EMAIL_FROM || "Musely <support@musely.tech>";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "support@musely.tech";

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendEmail({ to, subject, html, text }) {
  if (!emailConfigured()) {
    console.warn("[email] RESEND_API_KEY not set — skipping send to", to);
    return { skipped: true };
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
  return res.json();
}

// ---------- Templates ----------

const ACCENT = "#b8552f";
const INK = "#1f2328";
const MUTED = "#6b7280";

function waitlistConfirmationHtml() {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7f7f5;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">You're on the Musely waiting list — we'll be in touch soon.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e7e2;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="padding:40px 40px 0 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:40px;height:40px;background:${ACCENT};border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-size:20px;font-weight:700;line-height:40px;">M</td>
                    <td style="padding-left:12px;font-size:18px;font-weight:700;color:${INK};letter-spacing:-0.2px;">Musely</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 0 40px;">
                <h1 style="margin:0;font-size:24px;line-height:1.3;color:${INK};font-weight:700;letter-spacing:-0.4px;">You're on the list.</h1>
                <p style="margin:16px 0 0 0;font-size:15px;line-height:1.65;color:${MUTED};">
                  Thanks for joining the Musely waiting list. Musely is a writing companion that helps you
                  start faster, stay in flow, and actually write more — without staring at a blank page.
                </p>
                <p style="margin:16px 0 0 0;font-size:15px;line-height:1.65;color:${MUTED};">
                  We're opening access in small batches to keep the experience great. You'll get an email
                  from us the moment your spot is ready — no need to do anything until then.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 0 40px;">
                <div style="background:#fbeee7;border:1px solid #f3dccd;border-radius:12px;padding:16px 18px;">
                  <p style="margin:0;font-size:13px;line-height:1.6;color:${INK};">
                    <strong style="color:${ACCENT};">What happens next</strong><br />
                    We review the list, send invites in waves, and share early peeks along the way.
                  </p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 40px 40px;">
                <p style="margin:0;font-size:14px;line-height:1.6;color:${MUTED};">
                  Questions or ideas? Just reply to this email — a real person reads every one.
                </p>
                <p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;color:${INK};">
                  — The Musely team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:20px auto 0 auto;font-size:12px;line-height:1.5;color:#9aa0a6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">
            You're receiving this because you joined the Musely waiting list.<br />
            support@musely.tech
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function waitlistConfirmationText() {
  return [
    "You're on the list.",
    "",
    "Thanks for joining the Musely waiting list. Musely is a writing companion that",
    "helps you start faster, stay in flow, and actually write more.",
    "",
    "We're opening access in small batches. You'll get an email the moment your spot",
    "is ready — no need to do anything until then.",
    "",
    "Questions or ideas? Just reply to this email.",
    "",
    "— The Musely team",
    "support@musely.tech",
  ].join("\n");
}

export async function sendWaitlistConfirmation(to) {
  return sendEmail({
    to,
    subject: "You're on the Musely waiting list",
    html: waitlistConfirmationHtml(),
    text: waitlistConfirmationText(),
  });
}
