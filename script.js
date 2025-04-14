// Menu Mobile
function toggleMenu() {
  const mobileMenu = document.getElementById('mobileMenu');
  mobileMenu.classList.toggle('show');
}

document.querySelector('.hamburger').addEventListener('click', toggleMenu);

// Navigazione fluida per dispositivi (desktop e mobile)
document.querySelectorAll('.nav-links a, .mobile-menu a, .cta-button').forEach(link => {
  link.addEventListener('click', function(e) {
    e.preventDefault();
    const targetID = this.getAttribute('href');
    const targetElement = document.querySelector(targetID);
    if (targetElement) {
      window.scrollTo({
        top: targetElement.offsetTop - 70,
        behavior: 'smooth'
      });
    }
    // Chiudi il menu mobile se aperto
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu.classList.contains('show')) {
      mobileMenu.classList.remove('show');
    }
  });
});

// Gesture: rileva swipe orizzontali per mostrare/nascondere i testi laterali nella hero
let touchStartX = 0;
let touchEndX = 0;
const sensitivity = 50; // Pixels minimi per considerare lo swipe

document.addEventListener('touchstart', function(e) {
  touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', function(e) {
  touchEndX = e.changedTouches[0].screenX;
  if (touchStartX - touchEndX > sensitivity) {
    // Swipe Left: Nascondi i testi laterali
    document.querySelectorAll('.side-text').forEach(el => el.style.display = 'none');
  }
  if (touchEndX - touchStartX > sensitivity) {
    // Swipe Right: Mostra i testi laterali
    document.querySelectorAll('.side-text').forEach(el => el.style.display = 'block');
  }
});

// Gestione form di contatto
document.getElementById('contact-form').addEventListener('submit', function(e) {
  e.preventDefault();
  alert('Grazie per averci contattato! Ti risponderemo al più presto.');
  this.reset();
});
