document.getElementById('contact-form').addEventListener('submit', function(event) {
  event.preventDefault();
  
  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const message = document.getElementById('message').value;

  if (name && email && message) {
    alert(`Messaggio inviato da ${name}!\nEmail: ${email}\nMessaggio: ${message}`);
    
    // Puoi aggiungere qui la logica per inviare questi dati al server.
    
    document.getElementById('contact-form').reset();
  } else {
    alert('Per favore, completa tutti i campi!');
  }
});
