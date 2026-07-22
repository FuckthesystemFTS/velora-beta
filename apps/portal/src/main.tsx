import React from "react";
import ReactDOM from "react-dom/client";
import { portalBranding } from "./config/branding";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="brand-row">
          <div className="mark">V</div>
          <div>
            <p className="eyebrow">Velora Next</p>
            <strong>{portalBranding.portalName}</strong>
          </div>
        </div>
        <h1>Portale, account e pubblicazione in una sola esperienza.</h1>
        <p className="lede">
          {portalBranding.projectName} mantiene registrazione, licenze, richieste zona e sicurezza nello stesso
          flusso, con un layout piu compatto per desktop e mobile.
        </p>
        <div className="actions">
          <a href="/portal">Apri portale</a>
          <a href="/download">Download beta</a>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <span>Account</span>
          <h2>Registrazione rapida</h2>
          <form className="stack">
            <input placeholder="Username" />
            <input placeholder="Chiave licenza" />
            <input placeholder="Password" type="password" />
            <button type="button">Crea account</button>
          </form>
        </article>

        <article className="panel">
          <span>Release</span>
          <h2>Download e verifica</h2>
          <ul className="list">
            <li>Windows x64 MSI</li>
            <li>Hash SHA-256 pubblicato</li>
            <li>Istruzioni code signing</li>
            <li>Requisiti di sistema e changelog</li>
          </ul>
        </article>

        <article className="panel wide">
          <span>Dashboard</span>
          <h2>Area utente</h2>
          <div className="status-grid">
            <div>
              <strong>Licenza</strong>
              <p>Stato, piano, scadenza, dispositivi autorizzati.</p>
            </div>
            <div>
              <strong>Richieste zona</strong>
              <p>Disponibilità, stato revisione, certificati e recovery code.</p>
            </div>
            <div>
              <strong>Sicurezza</strong>
              <p>Revoca sessioni, dispositivi, hash installer e stato servizi.</p>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
