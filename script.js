// Effetto per la navigazione fluida
document.querySelectorAll('.nav-links a').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    });
});

// Gestures per mobile
let touchStartX = 0;
let touchEndX = 0;

document.body.addEventListener('touchstart', function (e) {
    touchStartX = e.changedTouches[0].screenX;
});
function toggleMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('show');
}

document.body.addEventListener('touchend', function (e) {
    touchEndX = e.changedTouches[0].screenX;
    if (touchEndX - touchStartX > 50) {
        // Esegui azione swipe a destra
        console.log('Swipe Right');
    } else if (touchStartX - touchEndX > 50) {
        // Esegui azione swipe a sinistra
        console.log('Swipe Left');
    }
});

// Anima il form di contatto
document.getElementById('contact-form').addEventListener('submit', function (e) {
    e.preventDefault();
    alert('Messaggio inviato! Ti risponderemo presto.');
});
