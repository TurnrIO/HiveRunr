import{j as o}from"./client-CiIurUyg.js";function d({title:t,subtitle:e,children:a,maxWidth:r=400}){return o.jsxs(o.Fragment,{children:[o.jsx("style",{children:i}),o.jsx("div",{className:"auth-outer",children:o.jsxs("div",{className:"auth-card",style:{maxWidth:r},children:[o.jsxs("div",{className:"auth-logo",children:[o.jsx("div",{className:"auth-logo-icon",children:"⚡"}),o.jsx("div",{className:"auth-logo-text",children:"HiveRunr"})]}),t&&o.jsx("h1",{className:"auth-title",children:t}),e&&o.jsx("p",{className:"auth-subtitle",children:e}),a]})})]})}const i=`
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d0f1a;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-height: 100vh;
  }
  .auth-outer {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }
  .auth-card {
    background: #13151f;
    border: 1px solid #1e2130;
    border-radius: 16px;
    padding: 40px 36px;
    width: 100%;
    box-shadow: 0 24px 64px rgba(0,0,0,.5);
  }
  .auth-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 32px;
    justify-content: center;
  }
  .auth-logo-icon {
    width: 38px;
    height: 38px;
    background: linear-gradient(135deg,#7c3aed,#a855f7);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  .auth-logo-text {
    font-size: 22px;
    font-weight: 700;
    color: #e2e8f0;
    letter-spacing: -.5px;
  }
  .auth-title {
    font-size: 18px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 4px;
    text-align: center;
  }
  .auth-subtitle {
    font-size: 13px;
    color: #64748b;
    text-align: center;
    margin-bottom: 28px;
  }
  .auth-field { margin-bottom: 18px; }
  .auth-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #94a3b8;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .auth-input {
    width: 100%;
    padding: 10px 13px;
    background: #0d0f1a;
    border: 1px solid #2a2d3e;
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 14px;
    outline: none;
    transition: border-color .15s;
  }
  .auth-input:focus { border-color: #7c3aed; }
  .auth-input[readonly] { opacity: .6; }
  .auth-hint { font-size: 11px; color: #475569; margin-top: 4px; }
  .auth-btn {
    width: 100%;
    padding: 11px;
    background: linear-gradient(135deg,#7c3aed,#6d28d9);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity .15s;
    margin-top: 8px;
  }
  .auth-btn:hover { opacity: .88; }
  .auth-btn:disabled { opacity: .5; cursor: not-allowed; }
  .auth-msg {
    border-radius: 8px;
    padding: 10px 13px;
    font-size: 13px;
    margin-bottom: 18px;
  }
  .auth-msg-error {
    background: #f871711a;
    border: 1px solid #f8717140;
    color: #fca5a5;
  }
  .auth-msg-success {
    background: #22c55e1a;
    border: 1px solid #22c55e40;
    color: #86efac;
  }
  .auth-link {
    display: block;
    text-align: center;
    font-size: 13px;
    color: #64748b;
    text-decoration: none;
    margin-top: 16px;
    cursor: pointer;
  }
  .auth-link:hover { color: #7c3aed; }
  .auth-link a { color: #7c3aed; text-decoration: none; }
  .auth-link a:hover { text-decoration: underline; }
  .auth-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: auth-spin .6s linear infinite;
    vertical-align: middle;
    margin-right: 6px;
  }
  @keyframes auth-spin { to { transform: rotate(360deg); } }
  .auth-forgot-link {
    display: block;
    text-align: right;
    font-size: 12px;
    color: #64748b;
    text-decoration: none;
    margin-top: -10px;
    margin-bottom: 14px;
    cursor: pointer;
  }
  .auth-forgot-link:hover { color: #7c3aed; }
  .auth-info-box {
    background: #1e2130;
    border: 1px solid #2d3148;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 13px;
    color: #94a3b8;
  }
  .auth-info-box strong { color: #e2e8f0; }
  .auth-plan-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    background: #7c3aed22;
    color: #a78bfa;
    border: 1px solid #7c3aed44;
    margin-left: 6px;
    vertical-align: middle;
  }
  .auth-role-badge {
    display: inline-block;
    background: #312e81;
    color: #a78bfa;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    margin-left: 6px;
  }
`;export{d as A};
