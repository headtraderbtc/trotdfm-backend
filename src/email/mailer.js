/* ============================================================
   EMAIL
   Pluggable SMTP sender. Works with Gmail, Outlook, SendGrid,
   Mailgun, or any other SMTP-compatible provider — just set
   the env vars below. If they're not set, emails are skipped
   and logged to the console instead, so the app still works
   without email configured.

   Required env vars (set these on Railway when ready):
     SMTP_HOST
     SMTP_PORT       (587 for most providers)
     SMTP_USER
     SMTP_PASS
     SMTP_FROM       (e.g. "The Royal Order <no-reply@yourdomain.com>")

   Gmail note: use an "app password", not your normal password.
   SendGrid/Mailgun note: SMTP_USER and SMTP_PASS come from their
   dashboard — works identically to any other SMTP provider.
   ============================================================ */

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return transporter;
}

async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log('[email skipped — SMTP not configured]', { to, subject });
    return { skipped: true };
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || 'The Royal Order <no-reply@theorder.local>',
      to, subject, html, text
    });
    return { sent: true };
  } catch (err) {
    console.error('[email send failed]', err.message);
    return { error: err.message };
  }
}

/* ---- Templated sends used across the app ---- */

function shellWrap(title, bodyHtml) {
  return `
  <div style="background:#03020a;padding:40px 20px;font-family:Georgia,serif;color:#e8e3f0;">
    <div style="max-width:480px;margin:0 auto;border:1px solid rgba(160,110,200,0.25);border-radius:10px;padding:32px;">
      <div style="text-align:center;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#a06de0;margin-bottom:18px;">
        The Royal Order
      </div>
      <h2 style="text-align:center;font-size:18px;letter-spacing:0.05em;text-transform:uppercase;color:#fff;margin:0 0 18px;">
        ${title}
      </h2>
      <div style="font-size:14px;line-height:1.7;color:rgba(232,227,240,0.8);">
        ${bodyHtml}
      </div>
    </div>
  </div>`;
}

async function sendApplicationReceived(member) {
  return sendEmail({
    to: member.email,
    subject: 'Your application to the Order has been received',
    html: shellWrap('Application received', `
      <p>Greetings, ${escapeHtml(member.name)}.</p>
      <p>Your request to join The Royal Order of The Dark Force of Matter now drifts
         at the edge of the void, awaiting review.</p>
      <p>You will be notified the moment a decision is made.</p>
    `)
  });
}

async function sendMembershipDecision(member, approved) {
  return sendEmail({
    to: member.email,
    subject: approved ? 'Welcome to the Order' : 'Regarding your application to the Order',
    html: shellWrap(
      approved ? 'Membership approved' : 'Application not approved',
      approved
        ? `<p>Greetings, ${escapeHtml(member.name)}.</p>
           <p>The Order has reviewed your application and welcomes you.
              You may now sign in and begin exploring or contributing to any world.</p>`
        : `<p>Greetings, ${escapeHtml(member.name)}.</p>
           <p>After review, the Order is unable to approve your application at this time.
              You are welcome to reapply in the future.</p>`
    )
  });
}

async function sendCometDecision(comet, proposerEmail, approved) {
  return sendEmail({
    to: proposerEmail,
    subject: approved
      ? `"${comet.name}" has entered orbit`
      : `Regarding your proposal: "${comet.name}"`,
    html: shellWrap(
      approved ? 'Your world has entered orbit' : 'Proposal not approved',
      approved
        ? `<p>Your proposed world, <strong>${escapeHtml(comet.name)}</strong>,
              has been approved by the Order and now orbits within the universe.</p>
           <p>It will grow as it gains contributors and activity.</p>`
        : `<p>Your proposal, <strong>${escapeHtml(comet.name)}</strong>,
              was not approved at this time.</p>
           <p>You're welcome to refine the idea and propose again.</p>`
    )
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
  sendEmail,
  sendApplicationReceived,
  sendMembershipDecision,
  sendCometDecision
};
