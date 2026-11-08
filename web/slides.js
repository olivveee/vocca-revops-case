"use strict";

// Four slides for Part 1B, in French (the cockpit, write-up and repo stay in English). Figures come from data/tam_cockpit.json, written by
// 1B_tam_mapping/tam_dedup.py, so the slides, the cockpit and the action pack always agree.

const fmt = new Intl.NumberFormat("fr-FR");
const AUTOMATIONS = ["API · enrichment pipeline", "API · n8n", "Attio · auto-created from email sync"];
const ICONS = {
  id: '<path d="M4 5h16v14H4z"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.6-1.6 1.6-2.4 2.5-2.4s1.9.8 2.5 2.4M14 10h4M14 13h3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  tree: '<rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v5M6 17v-5h12v5"/>',
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
  const hi = s.hierarchy_issues;
  const ip = s.hierarchy_invalid_parents || {};
  const underPractice = (ip["Practice under Practice"] || 0) + (ip["Group under Practice"] || 0);
  const wrongAccount = s.contact_moves["email domain belongs to another account family"] || 0;
  const rel = c.by_relationship || {};
  const outOfMarket = (rel.Invest || 0) + (rel.Partner || 0) + (rel.Media || 0);
  const noCompanyByTool = Math.round((c.contacts_without_company_by_tool / c.contacts_without_company) * 100);
  const us = s.markets.US || { accounts: 0 };

  return [
    `<section class="slide">
      <p class="kicker">1 · Ce qui ne va pas aujourd'hui</p>
      <h2>La base ne nous dit pas quel est notre marché</h2>
      <p class="sub">${fmt.format(c.accounts)} comptes dans Attio, lus tels quels.</p>
      <div class="body">
        <p class="group-title">Ce qui compte dans notre marché n'est pas défini</p>
        <div class="problems four">
          <div class="problem definition">
            <span class="what">Pas de définition commune des comptes</span>
            <span class="why">Tout est dans le même objet, sans distinction :</span>
            <ul class="defs">
              <li><b>TAM</b> tout le marché adressable, connu ou non</li>
              <li><b>SAM</b> ce qu'on adresse vraiment : ICP, marché couvert, une équipe</li>
              <li><b>Hors marché</b> partenaires, investisseurs, médias : suivis, jamais comptés</li>
            </ul>
          </div>
          <div class="problem">${icon("tag")}<span class="num">${fmt.format(outOfMarket)}</span><span class="what">Comptes hors marché</span><span class="why">${fmt.format(rel.Invest || 0)} investisseurs, ${fmt.format(rel.Partner || 0)} partenaires, ${fmt.format(rel.Media || 0)} médias mélangés aux prospects</span></div>
          <div class="problem">${icon("help")}<span class="num">${fmt.format(c.by_type.Missing || 0)}</span><span class="what">Comptes sans type</span><span class="why">ni site ni groupe : impossible à placer · + ${fmt.format(mi.country_inferred || 0)} comptes sans pays</span></div>
        </div>
        <p class="group-title">On ne sait pas qui est qui</p>
        <div class="problems four">
          <div class="problem">${icon("id")}<span class="num">${noId} %</span><span class="what">Pas d'identité fiable</span><span class="why">pas de SIRET validé en France ; aux US, ${fmt.format(us.without_company_number || 0)} comptes sur ${us.accounts} sans aucun numéro</span></div>
          <div class="problem">${icon("copy")}<span class="num">${fmt.format(s.records_removed_by_auto_merge)}</span><span class="what">Doublons certains</span><span class="why">+ ${fmt.format(d.review.length)} paires à faire valider par un humain</span></div>
          <div class="problem">${icon("tree")}<span class="num">${fmt.format(s.hierarchy_structure_errors)}</span><span class="what">Hiérarchie incohérente</span><span class="why">${fmt.format(hi.practice_looks_like_group || 0)} cabinets multi-sites, ${fmt.format(underPractice)} rattachés à un cabinet, ${fmt.format(hi.outside_its_group || 0)} sites hors de leur réseau, ${fmt.format(hi.self_parent || 0)} boucles : quelle structure pour déployer un groupe ?</span></div>
          <div class="problem">${icon("person")}<span class="num">${fmt.format(c.contacts_without_company)}</span><span class="what">Contacts rattachés à aucun compte</span><span class="why">+ ${fmt.format(wrongAccount)} sur le mauvais compte · aucune règle de création</span></div>
        </div>
        <div class="takeaway">Ce ne sont pas les équipes, ce sont les outils : <b>branchés au CRM mais pas orchestrés</b>, sans règle de création, ils créent au lieu de mettre à jour. Ils sont à l'origine de <b>${Math.round((dupAuto / dupTotal) * 100)} % des doublons</b> et de <b>${noCompanyByTool} % des contacts sans compte</b> (enrichissement, n8n, synchro email, téléphonie).</div>
      </div>
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
            <p class="note">Validé selon son type, c'est <b>la clé principale de dédoublonnage</b>. Sans numéro validé, une fusion automatique demande deux clés concordantes : même agenda + une autre clé, ou même SIREN + nom + code postal. Téléphone et domaine ne sont pas des clés : partagés par les groupes, ils servent à détecter les groupes.</p>
          </div>
        </div>
        <p class="rules-title">Jamais fusionné automatiquement</p>
        <div class="rules">
          <div class="rule"><span class="x">✕</span><p>Deux SIRET différents sont deux sites distincts ; s'ils ont le même agenda ou la même adresse, un humain vérifie.</p></div>
          <div class="rule"><span class="x">✕</span><p>Un même SIRET dans deux codes postaux est un numéro recopié par erreur : un humain vérifie.</p></div>
          <div class="rule"><span class="x">✕</span><p>Si un client ou deux commerciaux sont concernés, un humain décide : la fusion déplacerait des factures ou un portefeuille.</p></div>
          <div class="rule"><span class="x">✕</span><p>Un seul indice (même agenda, ou même nom et code postal sans SIRET) ou un compte sans type ne suffit pas.</p></div>
          <div class="rule"><span class="x">✕</span><p>Un site et un groupe qui partagent un SIREN ou un SIRET ne sont pas des doublons : on rattache le site au groupe.</p></div>
        </div>
      </div>
      ${mark(2)}
    </section>`,

    `<section class="slide">
      <p class="kicker">3 · Le build</p>
      <h2>Le TAM dans le warehouse, le SAM dans Attio</h2>
      <div class="body">
        <div class="flow">
          <div class="stage">
            <span class="tag">Sources, par marché</span>
            <div class="market"><b>France</b><div class="chips"><span class="chip-s">SIRENE</span><span class="chip-s">RPPS</span><span class="chip-s">FINESS</span><span class="chip-s">pages Doctolib</span></div></div>
            <div class="market"><b>États-Unis</b><div class="chips"><span class="chip-s">NPPES (NPI)</span><span class="chip-s">CMS (Medicare)</span><span class="chip-s">ordres des États</span></div></div>
            <div class="market"><b>Interne</b><div class="chips"><span class="chip-s">Attio</span><span class="chip-s">Hyperline</span><span class="chip-s">enrichissement (contacts seulement)</span></div></div>
          </div>
          <div class="arrow">→</div>
          <div class="stage core">
            <span class="tag">Warehouse · recalcul quotidien</span>
            <h3>Le TAM : tous les sites du marché, scorés</h3>
            <ol class="steps">
              <li><i>1</i><div><b>Normaliser</b><span>pays, adresses, téléphones, numéros validés selon leur type</span></div></li>
              <li><i>2</i><div><b>Structurer</b><span>dédoublonner, SIRET → SIREN → groupe, compte racine</span></div></li>
              <li><i>3</i><div><b>Segmenter</b><span>marché, spécialité, type de structure, taille (praticiens, sites)</span></div></li>
              <li><i>4</i><div><b>Scorer</b><span>fit ICP × potentiel → priorité, territoires, outbound</span></div></li>
            </ol>
          </div>
          <div class="arrow">→</div>
          <div class="stage">
            <span class="tag">Attio · synchro quotidienne</span>
            <h3>Le SAM : les comptes qu'on adresse</h3>
            <div class="chips"><span class="chip-s">identité générique</span><span class="chip-s">hiérarchie</span><span class="chip-s">compte racine</span><span class="chip-s">ID du master</span><span class="chip-s">marché</span><span class="chip-s">type de relation</span></div>
            <p class="note" style="margin:0">Poussé quand une équipe le travaille. Partenaires, investisseurs, médias : dans Attio, hors TAM et SAM. Attio ne réécrit que ce qui appartient aux Sales : propriétaire, cycle de vie, notes.</p>
          </div>
        </div>
        <div class="guards">
          <div class="panel">
            <h3>Propre par construction</h3>
            <ul>
              <li>Numéro d'entreprise <b>unique et validé</b> par pays</li>
              <li>Les automatisations <b>mettent à jour</b> si le compte existe, créent sinon</li>
              <li><b>Recherche avant création</b> dans Attio</li>
              <li>Pays obligatoire, <b>attribution par marché</b></li>
              <li><b>Type de compte et de relation</b> obligatoires</li>
              <li>Une <b>règle de création</b> par outil : qui crée quoi</li>
            </ul>
          </div>
          <div class="panel">
            <h3>Des humains là où ça compte</h3>
            <p class="note" style="margin:0">File de revue hebdomadaire portée par RevOps : <b>${fmt.format(d.review.length)}</b> paires aujourd'hui. Questions de structure tranchées avec les Sales : <b>${fmt.format(hi.empty_group || 0)}</b> groupes vides, <b>${fmt.format(hi.single_site_group || 0)}</b> groupes à un seul site. Indicateurs de qualité par marché, chaque semaine.</p>
          </div>
        </div>
      </div>
      ${mark(3)}
    </section>`,

    `<section class="slide">
      <p class="kicker">4 · Recommandations</p>
      <h2>Mettre à plat, designer, construire, mesurer</h2>
      <div class="body">
        <div class="phases">
          <div class="phase">
            <span class="when">S1-S2</span>
            <h3><i>1</i>Mettre à plat</h3>
            <p>Cartographier l'existant : chaque outil branché à Attio, ce qu'il crée et ce qu'il écrit, chaque flux, chaque propriétaire.</p>
            <span class="deliverable">Livrable : la carte des flux, qui crée quoi</span>
          </div>
          <div class="phase-arrow">→</div>
          <div class="phase">
            <span class="when">S2-S3</span>
            <h3><i>2</i>Décider et designer</h3>
            <p>L'architecture cible : types de compte et TAM / SAM / hors marché, identité générique, source de vérité par champ, règle de création par outil, rôle du warehouse et d'Attio.</p>
            <span class="deliverable">Livrable : le schéma cible, validé avec Sales, data et propriétaires des outils</span>
          </div>
          <div class="phase-arrow">→</div>
          <div class="phase">
            <span class="when">S3-S8</span>
            <h3><i>3</i>Construire</h3>
            <p>Identité dans Attio, outils en mise à jour, files vidées avec les Sales (${fmt.format(d.review.length)} paires, ${fmt.format(s.hierarchy_structure_errors)} hiérarchies), NPI US via NPPES, carte du TAM v1, puis le master dans le warehouse avec l'équipe data.</p>
            <span class="deliverable">Livrable : la carte du TAM v1 en S5, le master au mois 3</span>
          </div>
          <div class="phase-arrow">→</div>
          <div class="phase measure">
            <span class="when">Dès S2, en continu</span>
            <h3><i>4</i>Mesurer</h3>
            <p>Indicateurs qualité par marché : % d'identité validée, doublons ouverts, contacts sans compte, comptes créés par outil. Revue chaque semaine.</p>
            <span class="deliverable">Livrable : on sait si la base se dégrade, et pourquoi</span>
          </div>
        </div>
        <div class="parallel"><b>En parallèle, semaine 1 :</b> corriger ce qui fausse les chiffres (${fmt.format(s.records_removed_by_auto_merge)} fusions, ${fmt.format(hi.missing_type || 0)} types, ${fmt.format((s.market_issues || {}).country_inferred || 0)} pays, hors marché sortis des vues) et couper la création de sociétés par les outils.</div>
        <div class="closing">
          <div class="big">D'abord l'architecture, ensuite les outils<span>Le warehouse industrialise ce qu'on a designé et prouvé à la main.</span></div>
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
