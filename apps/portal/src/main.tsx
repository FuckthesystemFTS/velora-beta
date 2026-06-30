import React from "react";
import ReactDOM from "react-dom/client";
import { portalBranding } from "./config/branding";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">{portalBranding.portalName}</p>
        <h1>Accesso privato, pubblicazione firmata, rete distribuita.</h1>
        <p className="lede">
          {portalBranding.projectName} gestisce registrazione, licenze, bootstrap iniziale e richieste
          di zona senza trasformare Heroku nel punto di osservazione di tutta la navigazione.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Registrazione rapida</h2>
          <form className="stack">
            <input placeholder="Username" />
            <input placeholder="Chiave licenza" />
            <input placeholder="Password" type="password" />
            <button type="button">Crea account</button>
          </form>
        </article>

        <article className="panel">
          <h2>Download e verifica</h2>
          <ul className="list">
            <li>Windows x64 MSI</li>
            <li>Hash SHA-256 pubblicato</li>
            <li>Istruzioni code signing</li>
            <li>Requisiti di sistema e changelog</li>
          </ul>
        </article>

        <article className="panel wide">
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
