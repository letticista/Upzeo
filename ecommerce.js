// ===== CONFIGURAZIONE =====
// Dove arrivano gli ordini: modifica con i contatti dell'attività
const CONFIG = {
  whatsapp: '393461768386',          // numero in formato internazionale, senza + e spazi
  email: 'davidesalisweb@gmail.com',
  sogliaSpedizioneGratis: 49,
  costoSpedizione: 6.9,
};

// Catalogo: prezzi finali al cliente (in regime forfettario non si applica l'IVA)
const PRODOTTI = [
  { id: 'box-classico', cat: 'box', nome: 'Box "Borgo Classico"', desc: 'Olio extravergine 250 ml, pasta trafilata al bronzo, sugo di pomodoro e taralli artigianali.', prezzo: 49, emoji: '🧺', badge: 'Più scelta' },
  { id: 'box-tour', cat: 'box', nome: 'Box "Gran Tour d\'Italia"', desc: '8 specialità da 6 regioni, dal pesto al miele di montagna, con la storia di ogni produttore.', prezzo: 79, emoji: '🎁', badge: 'Idea regalo' },
  { id: 'box-strenna', cat: 'box', nome: 'Strenna aziendale', desc: 'Box con biglietto personalizzato e logo dell\'azienda. Da 20 box in su chiedi il listino dedicato.', prezzo: 39, emoji: '🏢', badge: 'Natale' },
  { id: 'abbonamento', cat: 'abbonamento', nome: 'BorgoBox del mese', desc: 'Ogni mese una regione diversa con 5–6 prodotti di stagione. Disdici quando vuoi.', prezzo: 34.9, unita: '/mese', emoji: '📦', badge: 'Ricorrente' },
  { id: 'olio', cat: 'dispensa', nome: 'Olio extravergine d\'oliva 0,75\u00a0L', desc: 'Spremuto a freddo da un frantoio di collina, dall\'ultima raccolta.', prezzo: 16.9, emoji: '🫒' },
  { id: 'pasta', cat: 'dispensa', nome: 'Pasta trafilata al bronzo · 3\u00a0×\u00a0500\u00a0g', desc: 'Grano duro italiano ed essiccazione lenta: paccheri, fusilloni e spaghettoni.', prezzo: 9.9, emoji: '🍝' },
  { id: 'sugo', cat: 'dispensa', nome: 'Sugo di pomodoro · 2\u00a0×\u00a0340\u00a0g', desc: 'Pomodoro italiano, basilico e olio extravergine. Pronto in 5 minuti.', prezzo: 8.5, emoji: '🍅' },
  { id: 'miele', cat: 'dispensa', nome: 'Miele millefiori di montagna 500\u00a0g', desc: 'Da piccoli apicoltori, non pastorizzato.', prezzo: 11.5, emoji: '🍯' },
];

// Parametri fiscali 2026: regime forfettario e INPS Gestione Commercianti
const FISCO = {
  sogliaForfettario: 85000,
  coefficienteRedditivita: 0.40,
  inpsRedditoMinimale: 18808,
  inpsContributoMinimo: 4611.64,
  inpsAliquota: 0.2448,
  inpsAliquotaOltre: 0.2548,
  inpsSogliaAliquota: 56224,
  riduzioneForfettari: 0.35,
};

const SCENARI = {
  prudente:    { ordini: 60,  scontrino: 45, merce: 50, logistica: 5.5, commissioni: 2.8, marketing: 500, fissi: 180 },
  realistico:  { ordini: 120, scontrino: 52, merce: 48, logistica: 5,   commissioni: 2.5, marketing: 900, fissi: 220 },
  ottimizzato: { ordini: 130, scontrino: 54, merce: 44, logistica: 4,   commissioni: 2.2, marketing: 800, fissi: 220 },
};

// ===== UTILITÀ =====
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const euroTondo = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const $ = (sel) => document.querySelector(sel);

const memoria = {
  leggi(chiave, predefinito) {
    try {
      const valore = localStorage.getItem(chiave);
      return valore === null ? predefinito : JSON.parse(valore);
    } catch (e) { return predefinito; }
  },
  scrivi(chiave, valore) {
    try { localStorage.setItem(chiave, JSON.stringify(valore)); } catch (e) { /* storage non disponibile */ }
  },
};

let timerToast;
function mostraToast(testo) {
  const toast = $('#toast');
  toast.textContent = testo;
  toast.classList.add('is-visible');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

// ===== TEMA CHIARO/SCURO =====
const bottoneTema = $('#theme-toggle');
const temaAttuale = () => document.documentElement.getAttribute('data-theme')
  || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const aggiornaIconaTema = () => { bottoneTema.textContent = temaAttuale() === 'dark' ? '☀️' : '🌙'; };

bottoneTema.addEventListener('click', () => {
  const prossimo = temaAttuale() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', prossimo);
  try { localStorage.setItem('borgobox-tema', prossimo); } catch (e) { /* storage non disponibile */ }
  aggiornaIconaTema();
});
aggiornaIconaTema();

// ===== CATALOGO =====
const griglia = $('#product-grid');

PRODOTTI.forEach((p) => {
  const card = document.createElement('article');
  card.className = 'product-card reveal';
  card.dataset.cat = p.cat;
  card.innerHTML = `
    <div class="product-visual cat-${p.cat}" aria-hidden="true">
      ${p.badge ? `<span class="badge">${p.badge}</span>` : ''}
      <span>${p.emoji}</span>
    </div>
    <div class="product-info">
      <h3>${p.nome}</h3>
      <p>${p.desc}</p>
      <div class="product-buy">
        <span class="price">${euro.format(p.prezzo)}${p.unita ? `<small>${p.unita}</small>` : ''}</span>
        <button type="button" class="add-btn" data-id="${p.id}" aria-label="Aggiungi ${p.nome.replace(/"/g, '&quot;')} al carrello">Aggiungi</button>
      </div>
    </div>
  `;
  griglia.appendChild(card);
});

griglia.addEventListener('click', (e) => {
  const bottone = e.target.closest('.add-btn');
  if (bottone) aggiungiAlCarrello(bottone.dataset.id);
});

document.querySelectorAll('.filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const filtro = chip.dataset.filtro;
    document.querySelectorAll('.filters .chip').forEach((c) => {
      c.classList.toggle('is-active', c === chip);
      c.setAttribute('aria-pressed', String(c === chip));
    });
    griglia.querySelectorAll('.product-card').forEach((card) => {
      card.hidden = filtro !== 'tutti' && card.dataset.cat !== filtro;
    });
  });
});

// ===== CARRELLO =====
// Solo id e quantità: nomi e prezzi vengono sempre dal catalogo
let carrello = memoria.leggi('borgobox-carrello', [])
  .filter((r) => r && PRODOTTI.some((p) => p.id === r.id))
  .map((r) => ({ id: r.id, qty: Math.min(99, Math.max(1, parseInt(r.qty, 10) || 1)) }));

const prodotto = (id) => PRODOTTI.find((p) => p.id === id);

function calcolaTotali() {
  const subtotale = carrello.reduce((s, r) => s + prodotto(r.id).prezzo * r.qty, 0);
  const spedizione = subtotale === 0 || subtotale >= CONFIG.sogliaSpedizioneGratis ? 0 : CONFIG.costoSpedizione;
  return { subtotale, spedizione, totale: subtotale + spedizione };
}

function aggiungiAlCarrello(id) {
  const riga = carrello.find((r) => r.id === id);
  if (riga) riga.qty = Math.min(99, riga.qty + 1);
  else carrello.push({ id, qty: 1 });
  aggiornaCarrello();
  const contatore = $('#cart-count');
  contatore.classList.remove('bump');
  void contatore.offsetWidth; // riavvia l'animazione
  contatore.classList.add('bump');
  mostraToast(`Aggiunto: ${prodotto(id).nome}`);
}

function cambiaQuantita(id, delta) {
  const riga = carrello.find((r) => r.id === id);
  if (!riga) return;
  riga.qty += delta;
  if (riga.qty < 1) carrello = carrello.filter((r) => r.id !== id);
  else riga.qty = Math.min(99, riga.qty);
  aggiornaCarrello();
}

function aggiornaCarrello() {
  memoria.scrivi('borgobox-carrello', carrello);
  const { subtotale, spedizione, totale } = calcolaTotali();
  const pezzi = carrello.reduce((s, r) => s + r.qty, 0);

  $('#cart-count').textContent = pezzi;
  $('#cart-empty').hidden = carrello.length > 0;
  $('#checkout-btn').disabled = carrello.length === 0;
  $('#cart-subtotal').textContent = euro.format(subtotale);
  $('#cart-shipping').textContent = carrello.length === 0 ? '–' : (spedizione === 0 ? 'Gratis' : euro.format(spedizione));
  $('#cart-total').textContent = euro.format(totale);
  $('#checkout-total').textContent = euro.format(totale);

  // Barra della spedizione gratuita: spinge ad aumentare lo scontrino medio
  const mancano = CONFIG.sogliaSpedizioneGratis - subtotale;
  $('#shipping-progress').hidden = carrello.length === 0;
  $('#shipping-text').textContent = mancano > 0
    ? `Ti mancano ${euro.format(mancano)} per la spedizione gratuita`
    : 'Hai diritto alla spedizione gratuita!';
  $('#shipping-fill').style.width = `${Math.min(100, (subtotale / CONFIG.sogliaSpedizioneGratis) * 100)}%`;

  const lista = $('#cart-items');
  lista.innerHTML = '';
  carrello.forEach((r) => {
    const p = prodotto(r.id);
    const li = document.createElement('li');
    li.className = 'cart-item';
    li.innerHTML = `
      <span class="cart-item-emoji" aria-hidden="true">${p.emoji}</span>
      <div>
        <p class="cart-item-name"></p>
        <p class="cart-item-price">${euro.format(p.prezzo)}${p.unita || ''}</p>
        <div class="qty">
          <button type="button" data-azione="meno" aria-label="Diminuisci quantità">−</button>
          <span>${r.qty}</span>
          <button type="button" data-azione="piu" aria-label="Aumenta quantità">+</button>
        </div>
      </div>
      <div>
        <p class="cart-item-total">${euro.format(p.prezzo * r.qty)}</p>
        <button type="button" class="remove-btn" data-azione="rimuovi">Rimuovi</button>
      </div>
    `;
    li.querySelector('.cart-item-name').textContent = p.nome;
    li.dataset.id = r.id;
    lista.appendChild(li);
  });
}

$('#cart-items').addEventListener('click', (e) => {
  const bottone = e.target.closest('button[data-azione]');
  if (!bottone) return;
  const id = bottone.closest('.cart-item').dataset.id;
  const azione = bottone.dataset.azione;
  if (azione === 'piu') cambiaQuantita(id, 1);
  if (azione === 'meno') cambiaQuantita(id, -1);
  if (azione === 'rimuovi') cambiaQuantita(id, -Infinity);
});

// ===== DRAWER: carrello → checkout → conferma =====
const drawer = $('#cart-drawer');
const sfondo = $('#drawer-backdrop');
const apriCarrelloBtn = $('#cart-open');

function mostraVista(nome) {
  $('#view-cart').hidden = nome !== 'cart';
  $('#view-checkout').hidden = nome !== 'checkout';
  $('#view-done').hidden = nome !== 'done';
  $('#drawer-title').textContent = { cart: 'Il tuo carrello', checkout: 'Dati per la consegna', done: 'Grazie!' }[nome];
}

function apriDrawer() {
  mostraVista('cart');
  drawer.hidden = false;
  sfondo.hidden = false;
  apriCarrelloBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  $('#cart-close').focus();
}

function chiudiDrawer() {
  drawer.hidden = true;
  sfondo.hidden = true;
  apriCarrelloBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  apriCarrelloBtn.focus();
}

apriCarrelloBtn.addEventListener('click', apriDrawer);
$('#cart-close').addEventListener('click', chiudiDrawer);
sfondo.addEventListener('click', chiudiDrawer);
$('#checkout-btn').addEventListener('click', () => {
  mostraVista('checkout');
  drawer.querySelector('input[name="nome"]').focus();
});
$('#back-to-cart').addEventListener('click', () => mostraVista('cart'));
$('#done-close').addEventListener('click', chiudiDrawer);

// Tastiera: Esc chiude, Tab resta dentro il drawer
document.addEventListener('keydown', (e) => {
  if (drawer.hidden) return;
  if (e.key === 'Escape') { chiudiDrawer(); return; }
  if (e.key !== 'Tab') return;
  const focusabili = [...drawer.querySelectorAll('button, a[href], input, select, textarea')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusabili.length) return;
  const primo = focusabili[0];
  const ultimo = focusabili[focusabili.length - 1];
  if (e.shiftKey && document.activeElement === primo) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primo.focus(); }
});

// ===== INVIO ORDINE (WhatsApp o email) =====
const moduloOrdine = $('#view-checkout');

function codiceOrdine() {
  const d = new Date();
  const data = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `BB-${data}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function testoOrdine(codice, dati) {
  const { subtotale, spedizione, totale } = calcolaTotali();
  const righe = carrello.map((r) => {
    const p = prodotto(r.id);
    return `• ${r.qty} × ${p.nome}${p.unita || ''} – ${euro.format(p.prezzo * r.qty)}`;
  });
  return [
    `Nuovo ordine BorgoBox ${codice}`,
    '',
    ...righe,
    '',
    `Subtotale: ${euro.format(subtotale)}`,
    `Spedizione: ${spedizione === 0 ? 'gratuita' : euro.format(spedizione)}`,
    `TOTALE: ${euro.format(totale)}`,
    `Pagamento: ${dati.get('pagamento')}`,
    '',
    `Cliente: ${dati.get('nome')}`,
    `Telefono: ${dati.get('telefono')}`,
    `Email: ${dati.get('email')}`,
    `Consegna: ${dati.get('indirizzo')}, ${dati.get('cap')} ${dati.get('citta')}`,
    dati.get('note') ? `Note: ${dati.get('note')}` : '',
  ].filter((riga, i, tutte) => riga !== '' || tutte[i - 1] !== '').join('\n').trim();
}

// Un campo corretto perde subito l'evidenziazione d'errore
moduloOrdine.addEventListener('input', (e) => {
  if (e.target.checkValidity()) e.target.removeAttribute('aria-invalid');
  if (!moduloOrdine.querySelector('[aria-invalid="true"]')) $('#form-error').hidden = true;
});

moduloOrdine.addEventListener('submit', (e) => {
  e.preventDefault();
  const errore = $('#form-error');
  const campi = [...moduloOrdine.querySelectorAll('input, select, textarea')];
  campi.forEach((c) => c.removeAttribute('aria-invalid'));

  if (!moduloOrdine.checkValidity()) {
    const nonValidi = campi.filter((c) => !c.checkValidity());
    nonValidi.forEach((c) => c.setAttribute('aria-invalid', 'true'));
    errore.textContent = nonValidi.every((c) => c.name === 'consenso')
      ? 'Per inviare l\'ordine accetta le condizioni di vendita e l\'informativa privacy.'
      : 'Compila i campi evidenziati (il CAP deve avere 5 cifre) e accetta le condizioni.';
    errore.hidden = false;
    nonValidi[0].focus();
    return;
  }
  errore.hidden = true;

  const dati = new FormData(moduloOrdine);
  const codice = codiceOrdine();
  const testo = testoOrdine(codice, dati);
  const canale = e.submitter && e.submitter.value === 'email' ? 'email' : 'whatsapp';
  const link = canale === 'email'
    ? `mailto:${CONFIG.email}?subject=${encodeURIComponent(`Ordine BorgoBox ${codice}`)}&body=${encodeURIComponent(testo)}`
    : `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(testo)}`;

  if (canale === 'email') window.location.href = link;
  else window.open(link, '_blank', 'noopener');

  $('#done-code').textContent = codice;
  const reinvia = $('#done-resend');
  reinvia.href = link;
  if (canale === 'email') reinvia.removeAttribute('target');
  else reinvia.setAttribute('target', '_blank');

  carrello = [];
  aggiornaCarrello();
  moduloOrdine.reset();
  mostraVista('done');
  $('#done-close').focus();
});

// ===== SIMULATORE DI PROFITTO =====
const formSim = $('#sim-form');
const CAMPI_SIM = ['ordini', 'scontrino', 'merce', 'logistica', 'commissioni', 'marketing', 'fissi'];
const FORMATO_OUTPUT = {
  ordini: (v) => numero.format(v),
  scontrino: (v) => euroTondo.format(v),
  merce: (v) => `${v}%`,
  logistica: (v) => euro.format(v),
  commissioni: (v) => `${numero.format(v)}%`,
  marketing: (v) => euroTondo.format(v),
  fissi: (v) => euroTondo.format(v),
};

function contributiInps(redditoForfettario, conRiduzione) {
  let contributi = FISCO.inpsContributoMinimo;
  if (redditoForfettario > FISCO.inpsRedditoMinimale) {
    contributi += (Math.min(redditoForfettario, FISCO.inpsSogliaAliquota) - FISCO.inpsRedditoMinimale) * FISCO.inpsAliquota;
  }
  if (redditoForfettario > FISCO.inpsSogliaAliquota) {
    contributi += (redditoForfettario - FISCO.inpsSogliaAliquota) * FISCO.inpsAliquotaOltre;
  }
  return conRiduzione ? contributi * (1 - FISCO.riduzioneForfettari) : contributi;
}

// Calcolo annuale: in forfettario tasse e contributi si pagano sul 40% dei ricavi, non sull'utile reale
function calcolaProfitto(v) {
  const ricaviMese = v.ordini * v.scontrino;
  const costiMese = {
    merce: ricaviMese * v.merce / 100,
    logistica: v.ordini * v.logistica,
    commissioni: ricaviMese * v.commissioni / 100,
    marketing: v.marketing,
    fissi: v.fissi,
  };
  const operativoMese = ricaviMese - Object.values(costiMese).reduce((a, b) => a + b, 0);
  const ricaviAnno = ricaviMese * 12;
  const operativoAnno = operativoMese * 12;
  const oltreSoglia = ricaviAnno > FISCO.sogliaForfettario;

  let inps = null;
  let imposta = null;
  let nettoAnno = null;
  if (!oltreSoglia) {
    const redditoForfettario = ricaviAnno * FISCO.coefficienteRedditivita;
    inps = contributiInps(redditoForfettario, v.riduzioneInps);
    imposta = Math.max(0, redditoForfettario - inps) * v.aliquota;
    nettoAnno = operativoAnno - inps - imposta;
  }
  return { ricaviMese, costiMese, operativoMese, ricaviAnno, operativoAnno, oltreSoglia, inps, imposta, nettoAnno };
}

// Primo numero di ordini al mese con utile netto non negativo (stessi costi e scontrino)
function ordiniDiPareggio(v) {
  for (let n = 1; n <= 2000; n++) {
    const r = calcolaProfitto({ ...v, ordini: n });
    if (r.oltreSoglia) return { n, oltreSoglia: true };
    if (r.nettoAnno >= 0) return { n, oltreSoglia: false };
  }
  return null;
}

function leggiSimulatore() {
  const v = {};
  CAMPI_SIM.forEach((c) => { v[c] = parseFloat(formSim.elements[c].value); });
  v.aliquota = parseFloat(formSim.querySelector('input[name="aliquota"]:checked').value);
  v.riduzioneInps = formSim.elements.riduzioneInps.checked;
  return v;
}

function impostaScenario(nome) {
  const s = SCENARI[nome];
  CAMPI_SIM.forEach((c) => { formSim.elements[c].value = s[c]; });
  document.querySelectorAll('.presets .chip').forEach((chip) => {
    const attivo = chip.dataset.scenario === nome;
    chip.classList.toggle('is-active', attivo);
    chip.setAttribute('aria-pressed', String(attivo));
  });
  aggiornaSimulatore();
}

function mostraAvviso(tipo, testo) {
  const avviso = $('#sim-alert');
  if (!tipo) { avviso.hidden = true; return; }
  avviso.className = `alert is-${tipo}`;
  avviso.innerHTML = `<span class="alert-icon" aria-hidden="true">${tipo === 'critical' ? '✕' : '!'}</span><span><strong>${tipo === 'critical' ? 'Attenzione' : 'Nota'}:</strong> </span>`;
  avviso.lastElementChild.append(testo);
  avviso.hidden = false;
}

function aggiornaSimulatore() {
  const v = leggiSimulatore();
  CAMPI_SIM.forEach((c) => { $(`#out-${c}`).textContent = FORMATO_OUTPUT[c](v[c]); });
  const r = calcolaProfitto(v);

  // Cifra principale
  const valore = $('#res-netto-mese');
  if (r.oltreSoglia) {
    $('#res-netto-label').textContent = 'Utile prima delle imposte al mese';
    valore.textContent = euroTondo.format(r.operativoMese);
    $('#res-netto-anno').textContent = `≈ ${euroTondo.format(r.operativoAnno)} all'anno, prima di IVA, IRPEF e INPS`;
  } else {
    $('#res-netto-label').textContent = 'Utile netto stimato al mese';
    valore.textContent = euroTondo.format(r.nettoAnno / 12);
    $('#res-netto-anno').textContent = `≈ ${euroTondo.format(r.nettoAnno)} all'anno, dopo tasse e contributi INPS`;
  }
  valore.classList.toggle('is-negative', (r.oltreSoglia ? r.operativoAnno : r.nettoAnno) < 0);

  // KPI
  $('#res-fatturato').textContent = euroTondo.format(r.ricaviAnno);
  $('#res-operativo').textContent = euroTondo.format(r.operativoAnno);
  $('#res-tasse').textContent = r.oltreSoglia ? 'n.d.' : euroTondo.format(r.inps + r.imposta);
  const pareggio = ordiniDiPareggio(v);
  $('#res-pareggio').textContent = !pareggio ? 'non raggiungibile'
    : pareggio.oltreSoglia ? 'oltre la soglia' : numero.format(pareggio.n);

  // Avvisi
  const quotaSoglia = r.ricaviAnno / FISCO.sogliaForfettario;
  if (r.oltreSoglia) {
    mostraAvviso('critical', `con ${euroTondo.format(r.ricaviAnno)} di fatturato superi la soglia di 85.000 € del forfettario: dall'anno successivo serve il regime ordinario (sopra 100.000 € l'uscita è immediata). Fai stimare IVA e IRPEF al commercialista.`);
  } else if (r.nettoAnno < 0) {
    mostraAvviso('critical', `con questi numeri l'attività è in perdita. Servono circa ${pareggio && !pareggio.oltreSoglia ? pareggio.n : 'più'} ordini al mese, uno scontrino medio più alto o meno spesa in pubblicità.`);
  } else if (quotaSoglia >= 0.85) {
    mostraAvviso('warning', `sei vicino alla soglia di 85.000 €: oltre questo fatturato il forfettario non è più applicabile.`);
  } else {
    mostraAvviso(null);
  }

  // Indicatore soglia forfettario
  const percentuale = Math.round(quotaSoglia * 100);
  const riempimento = $('#res-soglia-fill');
  riempimento.style.width = `${Math.min(100, quotaSoglia * 100)}%`;
  riempimento.classList.toggle('is-warning', quotaSoglia >= 0.85 && quotaSoglia <= 1);
  riempimento.classList.toggle('is-critical', quotaSoglia > 1);
  $('#res-soglia-testo').textContent = `${euroTondo.format(r.ricaviAnno)} · ${percentuale}%`;
  const misuratore = $('#res-soglia');
  misuratore.setAttribute('aria-valuenow', String(Math.min(100, percentuale)));
  misuratore.setAttribute('aria-valuetext', `${euroTondo.format(r.ricaviAnno)}, ${percentuale}% della soglia`);

  disegnaRipartizione(r);
}

// Barre: quanto di ogni 100 € incassati va a ciascun costo e quanto resta
function disegnaRipartizione(r) {
  const voci = [
    { nome: 'Merce', mese: r.costiMese.merce },
    { nome: 'Spedizione e imballo', mese: r.costiMese.logistica },
    { nome: 'Commissioni di pagamento', mese: r.costiMese.commissioni },
    { nome: 'Pubblicità', mese: r.costiMese.marketing },
    { nome: 'Costi fissi', mese: r.costiMese.fissi },
  ];
  if (!r.oltreSoglia) {
    voci.push({ nome: 'Contributi INPS', mese: r.inps / 12 });
    voci.push({ nome: 'Imposta sostitutiva', mese: r.imposta / 12 });
  }
  const risultatoMese = r.oltreSoglia ? r.operativoMese : r.nettoAnno / 12;
  voci.push({
    nome: risultatoMese >= 0 ? (r.oltreSoglia ? 'Utile prima delle imposte' : 'Utile netto') : 'Perdita',
    mese: risultatoMese,
    risultato: true,
  });

  voci.forEach((voce) => { voce.su100 = (voce.mese / r.ricaviMese) * 100; });
  const massimo = Math.max(...voci.map((voce) => Math.abs(voce.su100)), 1);

  const lista = $('#res-breakdown');
  lista.innerHTML = '';
  voci.forEach((voce) => {
    const li = document.createElement('li');
    li.className = `bar-row${voce.risultato ? ' is-result' : ''}`;
    li.tabIndex = 0;
    const classeBarra = voce.risultato ? (voce.mese >= 0 ? ' is-profit' : ' is-loss') : '';
    li.innerHTML = `
      <span class="bar-label"></span>
      <span class="bar-track"><span class="bar${classeBarra}" style="width:${(Math.abs(voce.su100) / massimo) * 100}%"></span></span>
      <span class="bar-value">${numero.format(Math.round(voce.su100 * 10) / 10)} €</span>
    `;
    li.querySelector('.bar-label').textContent = voce.nome;
    li.dataset.tooltip = `${voce.nome}: ${euroTondo.format(voce.mese)} al mese · ${euroTondo.format(voce.mese * 12)} all'anno`;
    li.setAttribute('aria-label', `${voce.nome}: ${numero.format(voce.su100)} euro ogni 100 incassati, ${euroTondo.format(voce.mese)} al mese`);
    lista.appendChild(li);
  });
}

// Tooltip delle barre (mouse e tastiera)
const tooltip = $('#tooltip');
function mostraTooltip(riga, x, y) {
  tooltip.textContent = riga.dataset.tooltip;
  tooltip.hidden = false;
  const larghezza = tooltip.offsetWidth;
  tooltip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - larghezza - 8))}px`;
  tooltip.style.top = `${y - tooltip.offsetHeight - 10}px`;
}
const listaBarre = $('#res-breakdown');
listaBarre.addEventListener('pointermove', (e) => {
  const riga = e.target.closest('.bar-row');
  if (riga) mostraTooltip(riga, e.clientX, e.clientY);
  else tooltip.hidden = true;
});
listaBarre.addEventListener('pointerleave', () => { tooltip.hidden = true; });
listaBarre.addEventListener('focusin', (e) => {
  const riquadro = e.target.getBoundingClientRect();
  mostraTooltip(e.target, riquadro.left + riquadro.width / 2, riquadro.top);
});
listaBarre.addEventListener('focusout', () => { tooltip.hidden = true; });
window.addEventListener('scroll', () => { tooltip.hidden = true; }, { passive: true });

formSim.addEventListener('input', (e) => {
  // Un valore modificato a mano non corrisponde più a uno scenario predefinito
  if (CAMPI_SIM.includes(e.target.name)) {
    document.querySelectorAll('.presets .chip').forEach((chip) => {
      chip.classList.remove('is-active');
      chip.setAttribute('aria-pressed', 'false');
    });
  }
  aggiornaSimulatore();
});
document.querySelectorAll('.presets .chip').forEach((chip) => {
  chip.addEventListener('click', () => impostaScenario(chip.dataset.scenario));
});

// ===== ANIMAZIONI AL SCROLL =====
const elementiReveal = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const osservatore = new IntersectionObserver((voci) => {
    voci.forEach((voce) => {
      if (voce.isIntersecting) {
        voce.target.classList.add('is-visible');
        osservatore.unobserve(voce.target);
      }
    });
  }, { threshold: 0.15 });
  elementiReveal.forEach((el) => osservatore.observe(el));
} else {
  elementiReveal.forEach((el) => el.classList.add('is-visible'));
}

// ===== AVVIO =====
$('#anno').textContent = new Date().getFullYear();
aggiornaCarrello();
impostaScenario('realistico');
