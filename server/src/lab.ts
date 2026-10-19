import express from 'express';

// SAFE, FICTIONAL phishing look-alike fixtures for Haven forensics demos.
// "Glimmer" / "GlimmerCoin" / "Pixel Forge" are invented brands — these pages never impersonate a real
// company, and every form is inert (onsubmit="return false" + no working endpoint). They exist only so
// Rex's link-detonation sandbox has something dramatic-but-harmless to analyze in a live demo.

export const labRouter = express.Router();

const page = (title: string, labDomain: string, body: string, head = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="haven-lab-domain" content="${labDomain}">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;color:#f5f3ff}
  .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px}
  .card{width:100%;max-width:460px;background:rgba(17,12,34,.82);border:1px solid rgba(168,139,250,.35);border-radius:22px;padding:34px;box-shadow:0 30px 80px rgba(76,29,149,.55),inset 0 1px 0 rgba(255,255,255,.08)}
  .brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:22px;letter-spacing:-.4px}
  .logo{width:40px;height:40px;border-radius:12px;background:conic-gradient(from 210deg,#a855f7,#6366f1,#ec4899,#a855f7);box-shadow:0 8px 24px rgba(168,85,247,.6)}
  h1{font-size:27px;line-height:1.15;margin:22px 0 6px;letter-spacing:-.6px}
  .sub{color:#c4b5fd;font-size:15px;margin:0 0 20px}
  .timer{display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,rgba(244,63,94,.22),rgba(217,70,239,.18));border:1px solid rgba(244,63,94,.45);border-radius:12px;padding:11px 14px;font-size:14px;font-weight:600;color:#fecdd3;margin-bottom:22px}
  .count{font-variant-numeric:tabular-nums;font-weight:800;color:#fff}
  label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:#a5b4fc;margin:16px 0 6px}
  input,textarea{width:100%;padding:13px 14px;border-radius:11px;border:1px solid rgba(148,130,230,.4);background:rgba(10,8,22,.8);color:#fff;font-size:15px;font-family:inherit}
  input:focus,textarea:focus{outline:none;border-color:#a855f7;box-shadow:0 0 0 3px rgba(168,85,247,.25)}
  .cta{width:100%;margin-top:24px;padding:15px;border:0;border-radius:13px;font-size:16px;font-weight:800;color:#1a0b2e;cursor:pointer;background:linear-gradient(90deg,#f0abfc,#c084fc,#818cf8);box-shadow:0 14px 34px rgba(192,132,252,.5)}
  .cta:hover{filter:brightness(1.07)}
  .fine{margin-top:16px;font-size:11px;color:#8b7fc7;text-align:center;line-height:1.5}
  .pill{display:inline-block;background:rgba(168,85,247,.2);border:1px solid rgba(168,85,247,.4);color:#e9d5ff;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:700;margin-bottom:14px}
  .glow{position:fixed;inset:0;z-index:-1;background:radial-gradient(1000px 600px at 50% -10%,rgba(124,58,237,.45),transparent),radial-gradient(700px 500px at 90% 110%,rgba(236,72,153,.3),transparent),#07040f}
</style>${head}</head>
<body><div class="glow"></div><div class="wrap">${body}</div></body></html>`;

// GET / — index of fixtures
labRouter.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Haven Lab — Demo Fixtures</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:#07040f;color:#ede9fe;padding:40px;line-height:1.6}
.banner{background:linear-gradient(90deg,rgba(250,204,21,.18),rgba(244,63,94,.14));border:1px solid rgba(250,204,21,.4);color:#fde68a;border-radius:14px;padding:16px 18px;max-width:640px;font-weight:600}
h1{letter-spacing:-.6px}a{color:#c084fc;display:block;margin:10px 0;font-size:17px;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}
.meta{color:#8b7fc7;font-size:13px;margin-left:8px;font-weight:400}ul{list-style:none;padding:0;max-width:640px}</style></head>
<body><h1>Haven Lab</h1>
<div class="banner">Safe phishing look-alike fixtures for Haven demos. Forms post nowhere. Brands are fictional.</div>
<ul>
<li><a href="/lab/glimmer-rewards">/lab/glimmer-rewards<span class="meta">— fictional brand credential-harvest page (malicious)</span></a></li>
<li><a href="/lab/wallet-airdrop">/lab/wallet-airdrop<span class="meta">— fictional crypto seed-phrase scam (malicious)</span></a></li>
<li><a href="/lab/community-guidelines">/lab/community-guidelines<span class="meta">— benign community page</span></a></li>
</ul></body></html>`);
});

// GET /glimmer-rewards — dramatic (but fictional) brand credential page
labRouter.get('/glimmer-rewards', (_req, res) => {
  // Intentionally "obfuscated" but harmless inline script: atob of a benign string, eval'd.
  const obf = `<script>try{var _p=atob("Y29uc29sZS5sb2coIkdsaW1tZXIgcmV3YXJkcyBsb2FkZWQiKQ==");eval(_p);}catch(e){}</script>`;
  const timer = `<script>var t=599;setInterval(function(){t=t>0?t-1:0;var m=String(Math.floor(t/60)).padStart(2,'0'),s=String(t%60).padStart(2,'0');var el=document.getElementById('c');if(el)el.textContent=m+':'+s;},1000);</script>`;
  const body = `<div class="card">
    <div class="brand"><span class="logo"></span> Glimmer<span style="color:#c084fc">Premium</span></div>
    <span class="pill" style="margin-top:18px">🎁 Member reward</span>
    <h1>Claim your free 3 months of Glimmer Premium</h1>
    <p class="sub">Your account was selected. Verify your account now to claim — limited time only.</p>
    <div class="timer">⏳ Offer expires in <span class="count" id="c">09:59</span> — act now before it's gone</div>
    <form onsubmit="return false" action="http://glimmer-auth-verify.top/collect" method="post">
      <label>Email address</label>
      <input type="email" name="email" placeholder="you@email.com" autocomplete="off" required>
      <label>Password</label>
      <input type="password" name="password" placeholder="Your Glimmer password" autocomplete="off" required>
      <label>2FA / verification code</label>
      <input type="text" name="otp" inputmode="numeric" placeholder="6-digit code" autocomplete="off">
      <button class="cta" type="submit">Verify account &amp; claim reward →</button>
    </form>
    <p class="fine">Fictional demo page for Haven forensics. This is not a real company and no data is collected or sent.</p>
  </div>
  <iframe src="about:blank" style="display:none" width="0" height="0" aria-hidden="true"></iframe>`;
  res.type('html').send(page('Glimmer Premium — Claim your free 3 months', 'glimmer-rewards-claim.xyz', body, obf + timer));
});

// GET /wallet-airdrop — fictional crypto seed-phrase scam
labRouter.get('/wallet-airdrop', (_req, res) => {
  const timer = `<script>var t=299;setInterval(function(){t=t>0?t-1:0;var m=String(Math.floor(t/60)).padStart(2,'0'),s=String(t%60).padStart(2,'0');var el=document.getElementById('c');if(el)el.textContent=m+':'+s;},1000);</script>`;
  const body = `<div class="card">
    <div class="brand"><span class="logo" style="background:conic-gradient(from 120deg,#22d3ee,#a855f7,#f59e0b,#22d3ee)"></span> GlimmerCoin</div>
    <span class="pill" style="margin-top:18px">🚀 Airdrop live</span>
    <h1>GlimmerCoin Airdrop — 5,000 GLMR waiting</h1>
    <p class="sub">Connect your wallet and enter your 12-word recovery phrase to claim your bonus allocation instantly.</p>
    <div class="timer">⏳ Claim window closes in <span class="count" id="c">04:59</span> — don't miss your allocation</div>
    <form onsubmit="return false" action="http://glimmer-airdrop-bonus.click/sync" method="post">
      <label>Wallet recovery phrase (12 words)</label>
      <textarea name="seed" rows="3" placeholder="enter your 12-word secret recovery phrase" autocomplete="off"></textarea>
      <label>Wallet password</label>
      <input type="password" name="walletpass" placeholder="wallet password" autocomplete="off">
      <button class="cta" type="submit" style="background:linear-gradient(90deg,#67e8f9,#818cf8,#f0abfc)">Connect wallet &amp; claim 5,000 GLMR →</button>
    </form>
    <p class="fine">Fictional demo page for Haven forensics. No real wallet, token, or recovery phrase is involved and nothing is collected.</p>
  </div>`;
  res.type('html').send(page('GlimmerCoin Airdrop — Connect wallet', 'glimmer-airdrop-bonus.click', body, timer));
});

// GET /community-guidelines — benign
labRouter.get('/community-guidelines', (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="haven-lab-domain" content="pixelforge.community">
<title>Pixel Forge — Community Guidelines</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:linear-gradient(180deg,#f8fafc,#eef2ff);color:#1e293b;line-height:1.7}
.wrap{max-width:720px;margin:0 auto;padding:48px 28px}
.hero{display:flex;align-items:center;gap:14px;margin-bottom:8px}
.logo{width:44px;height:44px;border-radius:13px;background:linear-gradient(135deg,#34d399,#3b82f6);box-shadow:0 10px 24px rgba(59,130,246,.3)}
h1{font-size:30px;letter-spacing:-.6px;margin:0}.lede{color:#475569;font-size:17px}
h2{font-size:19px;margin-top:30px;color:#0f172a}p,li{color:#334155}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:26px 28px;box-shadow:0 8px 30px rgba(15,23,42,.06);margin-top:22px}
.tag{display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:700}</style></head>
<body><div class="wrap">
<div class="hero"><span class="logo"></span><h1>Pixel Forge</h1></div>
<span class="tag">Community guidelines</span>
<p class="lede">Welcome to Pixel Forge — a friendly home for indie game makers. A few shared values keep this place kind and creative.</p>
<div class="card">
<h2>Be kind and assume good faith</h2>
<p>Treat everyone with respect. Critique work, not people. We're all here to make cool things and learn.</p>
<h2>Keep it on-topic and spam-free</h2>
<p>Share your projects, ask for feedback, and help others. No unsolicited DMs, referral spam, or self-promo dumps.</p>
<h2>Credit creators</h2>
<p>Always credit art, music, and code you didn't make yourself, and respect licenses.</p>
<h2>Report, don't retaliate</h2>
<p>If something crosses a line, flag it to a moderator. We review every report fairly and quickly.</p>
</div>
<p style="color:#64748b;margin-top:26px;font-size:14px">Thanks for helping keep Pixel Forge a welcoming place. — The Mod Team</p>
</div></body></html>`);
});
