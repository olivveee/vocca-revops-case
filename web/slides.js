"use strict";

// Four slides for Part 1B, in French (the cockpit, write-up and repo stay in English). Figures come from data/tam_cockpit.json, written by
// scripts/tam_dedup.py, so the slides, the cockpit and the action pack always agree.

const fmt = new Intl.NumberFormat("fr-FR");
const millions = (v) => `${(v / 1e6).toFixed(1).replace(".", ",")} M€`;
const AUTOMATIONS = ["API · enrichment pipeline", "API · n8n", "Attio · auto-created from email sync"];
const ICONS = {
  id: '<path d="M4 5h16v14H4z"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.6-1.6 1.6-2.4 2.5-2.4s1.9.8 2.5 2.4M14 10h4M14 13h3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  euro: '<path d="M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9"/>',
  tree: '<rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v5M6 17v-5h12v5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const mark = (n) => `<span class="footer-mark">Vocca · Case Senior RevOps · Partie 1B · ${n} / 4</span>`;

function slides(d) {
  const c = d.current;
  const s = d.summary;
  const mi = s.market_issues || {};
  const noId = Math.round(((c.accounts - c.company_number_validated) / c.accounts) * 100);
  const dupTotal = Object.values(d.duplicate_sources).reduce((t, v) => t + v, 0);
  const dupAuto = Object.entries(d.duplicate_sources).filter(([k]) => AUTOMATIONS.includes(k)).reduce((t, [, v]) => t + v, 0);
  const hierTotal = Object.values(s.hierarchy_issues).reduce((t, v) => t + v, 0);
  const wrongAccount = s.contact_moves["email domain belongs to another account family"] || 0;
  const us = s.markets.US || { accounts: 0 };

  return [
    `<section class="slide">
      <p class="kicker">1 · Ce qui ne va pas aujourd'hui</p>
      <h2>La base ne nous dit pas quel est notre marché</h2>
      <p class="sub">${fmt.format(c.accounts)} comptes dans Attio, lus tels quels.</p>
      <div class="body"><div class="problems">
        <div class="problem">${icon("id")}<span class="num">${noId} %</span><span class="what">Pas d'identité fiable</span><span class="why">Pas de SIRET validé en France, aucun NPI valide sur les ${us.accounts} comptes US</span></div>
        <div class="problem">${icon("copy")}<span class="num">${fmt.format(s.records_removed_by_auto_merge)}</span><span class="what">Doublons certains</span><span class="why">+ ${fmt.format(d.review.length)} paires qui demandent un humain</span></div>
        <div class="problem">${icon("euro")}<span class="num">${millions(c.arr_double_counted_eur)}</span><span class="what">ARR compté deux fois</span><span class="why">Sur un site et sur son groupe, pour ${millions(c.customer_arr_eur)} d'ARR client</span></div>
        <div class="problem">${icon("tree")}<span class="num">${fmt.format(hierTotal)}</span><span class="what">Ruptures de hiérarchie</span><span class="why">${fmt.format(mi.group_missing || 0)} organisations multi-sites sans groupe, des groupes sous des cabinets, des boucles</span></div>
        <div class="problem">${icon("globe")}<span class="num">${fmt.format(mi.owner_market_mismatch || 0)}</span><span class="what">Comptes US portés par l'équipe française</span><span class="why">+ ${fmt.format(mi.out_of_tam || 0)} investisseurs, partenaires et médias comptés dans le TAM</span></div>
        <div class="problem">${icon("person")}<span class="num">${fmt.format(wrongAccount)}</span><span class="what">Contacts sur le mauvais compte</span><span class="why">+ ${fmt.format(c.contacts_without_company)} contacts sans société</span></div>
      </div>
      <div class="takeaway">Le désordre se recrée en continu : <b>${Math.round((dupAuto / dupTotal) * 100)} % des doublons ont été créés par des automatisations</b> (enrichissement, n8n, synchro email) qui insèrent au lieu de mettre à jour.</div></div>
      ${mark(1)}
    </section>`,

    `<section class="slide">
      <p class="kicker">2 · Le modèle</p>
      <h2>Un modèle de compte, une identité, tous les marchés</h2>
      <div class="body">
        <div class="model">
          <div class="panel">
            <h3>Ce qu'est un compte</h3>
            <div class="tree">
              <div class="node"><b>Réseau</b><span>une chaîne de groupes</span></div><div></div>
              <div class="down">↓</div><div></div>
              <div class="node"><b>Groupe</b><span>décision et contrat cadre</span></div><div class="node side"><b>Entité légale</b><span>contrats, factures ; reliée, pas un niveau</span></div>
              <div class="down">↓</div><div></div>
              <div class="node account"><b>Site = le compte</b><span>un lieu, un agenda : ce que Vocca déploie et facture. L'ARR vit ici</span></div><div class="node side"><b>Praticien</b><span>base de la tarification, champion ; peut exercer dans plusieurs sites</span></div>
            </div>
          </div>
          <div class="panel">
            <h3>Une identité générique dans Attio</h3>
            <table class="identity">
              <thead><tr><th>Champ</th><th>France</th><th>États-Unis</th></tr></thead>
              <tbody>
                <tr><td><code>country</code></td><td>FR</td><td>US</td></tr>
                <tr><td><code>company_number</code> + type</td><td>SIRET</td><td>NPI (organisation)</td></tr>
                <tr><td><code>legal_entity</code></td><td>SIREN</td><td>raison sociale + État</td></tr>
                <tr><td><code>practitioner_number</code></td><td>RPPS</td><td>NPI (individuel)</td></tr>
              </tbody>
            </table>
            <p class="note">Validé selon son type, c'est ensuite <b>la seule clé de dédoublonnage</b>. Clés de secours partout : URL d'agenda, adresse, téléphone, domaine, nom + code postal. Les colonnes propres à chaque pays restent en amont.</p>
          </div>
        </div>
        <p class="rules-title">Jamais fusionné automatiquement</p>
        <div class="rules">
          <div class="rule"><span class="x">✕</span><div><b>Deux numéros validés différents</b><span>deux sites, même d'une même société : on relie, on ne fusionne pas</span></div></div>
          <div class="rule"><span class="x">✕</span><div><b>Un client ou deux commerciaux</b><span>un humain valide toute fusion qui déplace de l'ARR ou une attribution</span></div></div>
          <div class="rule"><span class="x">✕</span><div><b>Téléphone, domaine ou nom seuls</b><span>partagés par les groupes ; un domaine dans plusieurs villes, c'est un groupe à créer</span></div></div>
        </div>
      </div>
      ${mark(2)}
    </section>`,

    `<section class="slide">
      <p class="kicker">3 · Le build</p>
      <h2>Le master dans le warehouse, Attio en copie opérationnelle</h2>
      <div class="body">
        <div class="flow">
          <div class="stage">
            <span class="tag">Sources, par marché</span>
            <div class="market"><b>France</b><div class="chips"><span class="chip-s">SIRENE</span><span class="chip-s">RPPS</span><span class="chip-s">FINESS</span><span class="chip-s">pages Doctolib</span></div></div>
            <div class="market"><b>États-Unis</b><div class="chips"><span class="chip-s">NPPES (NPI)</span><span class="chip-s">données CMS</span><span class="chip-s">ordres des États</span></div></div>
            <div class="market"><b>Interne</b><div class="chips"><span class="chip-s">Attio</span><span class="chip-s">Hyperline</span><span class="chip-s">enrichissement (contacts seulement)</span></div></div>
          </div>
          <div class="arrow">→</div>
          <div class="stage core">
            <span class="tag">Warehouse · chaque nuit</span>
            <h3>Référentiel site, groupe, entité légale, praticien</h3>
            <ol class="steps">
              <li><i>1</i>Normaliser dans le modèle générique</li>
              <li><i>2</i>Valider les numéros, matcher sur les clés</li>
              <li><i>3</i>Survivant : client, deals, complétude</li>
              <li><i>4</i>Tests : pas de boucle, ARR sur un seul niveau</li>
            </ol>
          </div>
          <div class="arrow">→</div>
          <div class="stage">
            <span class="tag">Attio · synchro quotidienne</span>
            <h3>Ce que voient les Sales</h3>
            <div class="chips"><span class="chip-s">identité générique</span><span class="chip-s">hiérarchie</span><span class="chip-s">ID du master</span><span class="chip-s">marché</span></div>
            <p class="note" style="margin:0">Attio ne réécrit que ce qui appartient aux Sales : propriétaire, cycle de vie, notes.</p>
          </div>
        </div>
        <div class="guards">
          <div class="panel">
            <h3>Propre par construction</h3>
            <ul>
              <li>Numéro d'entreprise <b>unique et validé</b> par pays</li>
              <li>Les automatisations <b>mettent à jour</b>, sans jamais insérer</li>
              <li><b>Recherche avant création</b> dans Attio</li>
              <li>Pays obligatoire, <b>attribution par marché</b></li>
            </ul>
          </div>
          <div class="panel">
            <h3>Des humains là où ça compte</h3>
            <p class="note" style="margin:0">File de revue hebdomadaire portée par RevOps : <b>${fmt.format(d.review.length)}</b> paires aujourd'hui. Indicateurs de qualité par marché, chaque semaine.</p>
          </div>
        </div>
      </div>
      ${mark(3)}
    </section>`,

    `<section class="slide">
      <p class="kicker">4 · Recommandations</p>
      <h2>D'abord arrêter l'hémorragie, ensuite construire le master</h2>
      <div class="body">
        <div class="roadmap">
          <div></div>${[1, 2, 3, 4, 5, 6, 7, 8].map((w) => `<div class="wk">S${w}</div>`).join("")}
          <div class="label"><b>P0</b>Arrêter l'hémorragie</div><div class="bar" style="grid-column: span 1">Identité + MAJ</div><div style="grid-column: span 7"></div>
          <div class="label"><b>P0</b>Corriger le reporting</div><div class="bar" style="grid-column: span 2">${fmt.format(s.records_removed_by_auto_merge)} fusions · ARR sur les sites</div><div style="grid-column: span 6"></div>
          <div class="label"><b>P1</b>Master record</div><div></div><div class="bar p1" style="grid-column: span 4">Modèles warehouse + synchro vers Attio</div><div style="grid-column: span 3"></div>
          <div class="label"><b>P1</b>Files · identité US</div><div></div><div class="bar p1" style="grid-column: span 3">${fmt.format(d.review.length)} revues · NPI des ${us.accounts} comptes US</div><div style="grid-column: span 4"></div>
          <div class="label"><b>P2</b>Dimensionner le TAM</div><div style="grid-column: span 4"></div><div class="bar p2" style="grid-column: span 3">Registres par marché, US d'abord</div><div></div>
          <div class="label"><b>P3</b>Faire tourner</div><div style="grid-column: span 2"></div><div class="bar p3" style="grid-column: span 6">Indicateurs et revue hebdo, tests warehouse</div>
        </div>
        <div class="closing">
          <div class="big">6 à 8 semaines, une personne<span>Valeur visible dès la semaine 2 : doublons fusionnés, ARR compté une fois, comptes US avec leur équipe.</span></div>
          <a class="cta" href="tam.html">Ouvrir le cockpit TAM →</a>
        </div>
      </div>
      ${mark(4)}
    </section>`,
  ];
}

// ---------- navigation ----------
let current = 0;
let total = 0;
function show(i) {
  const all = document.querySelectorAll(".slide");
  current = Math.max(0, Math.min(total - 1, i));
  all.forEach((el, n) => el.classList.toggle("active", n === current));
  document.getElementById("counter").textContent = `${current + 1} / ${total}`;
  history.replaceState(null, "", `#${current + 1}`);
}
document.getElementById("prev").addEventListener("click", () => show(current - 1));
document.getElementById("next").addEventListener("click", () => show(current + 1));
document.getElementById("fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
document.addEventListener("keydown", (e) => {
  if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); show(current + 1); }
  if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); show(current - 1); }
  if (e.key === "Home") show(0);
  if (e.key === "End") show(total - 1);
  if (e.key === "f") document.getElementById("fullscreen").click();
});

window.addEventListener("hashchange", () => {
  const n = parseInt(location.hash.slice(1), 10);
  if (Number.isFinite(n) && n - 1 !== current) show(n - 1);
});

fetch("data/tam_cockpit.json", { cache: "no-store" })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((d) => {
    const html = slides(d);
    total = html.length;
    document.getElementById("deck").innerHTML = html.join("");
    const fromHash = parseInt(location.hash.slice(1), 10);
    show(Number.isFinite(fromHash) ? fromHash - 1 : 0);
  })
  .catch((err) => {
    document.getElementById("deck").innerHTML = `<section class="slide active"><h2>Impossible de charger les données</h2><p class="sub">${String(err.message)}</p></section>`;
  });
