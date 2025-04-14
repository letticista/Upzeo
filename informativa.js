const puntiPrivacy = [
  "1. Raccolta dei dati personali solo se strettamente necessario.",
  "2. I dati vengono raccolti con il consenso dell'utente.",
  "3. Non vendiamo né condividiamo dati a terze parti senza autorizzazione.",
  "4. I dati sono usati per finalità operative e di comunicazione.",
  "5. Uso dei cookie per migliorare l’esperienza dell’utente.",
  "6. Utilizzo di strumenti analitici come Google Analytics.",
  "7. I dati raccolti possono includere IP, browser, sistema operativo.",
  "8. Sicurezza garantita tramite protocolli HTTPS e crittografia.",
  "9. I dati possono essere conservati fino a 24 mesi.",
  "10. Gli utenti possono richiedere la cancellazione dei dati.",
  "11. I minori di 16 anni devono avere il consenso dei genitori.",
  "12. Newsletter inviate solo su iscrizione volontaria.",
  "13. Accesso limitato ai dati da parte del personale autorizzato.",
  "14. Hosting sicuro tramite provider con data center in UE.",
  "15. Backup automatici e crittografati effettuati settimanalmente.",
  "16. L’utente ha diritto alla portabilità dei propri dati.",
  "17. L’utente ha diritto alla rettifica dei dati errati.",
  "18. Le modifiche alla privacy policy saranno comunicate tempestivamente.",
  "19. I dati non vengono trasferiti fuori dallo Spazio Economico Europeo.",
  "20. Viene rispettata la normativa GDPR (Regolamento UE 2016/679).",
  "21. I form sul sito includono checkbox per il consenso esplicito.",
  "22. Nessun tracciamento attivo al di fuori del sito (no cross-site).",
  "23. I dati per le richieste commerciali sono conservati massimo 6 mesi.",
  "24. Il sito non utilizza fingerprinting né tecnologie invasive.",
  "25. Contatti per info privacy: privacy@upzeo.infy.uk",
];

const policyList = document.getElementById("policy-list");

puntiPrivacy.forEach((punto) => {
  const li = document.createElement("li");
  li.textContent = punto;
  policyList.appendChild(li);
});
