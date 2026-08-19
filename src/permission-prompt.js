const params = new URLSearchParams(location.search);
document.getElementById('msg').textContent = params.get('msg') || '';
document.getElementById('allow').textContent = params.get('allowLabel') || 'Permitir';
document.getElementById('deny').textContent = params.get('denyLabel') || 'Bloquear';
document.getElementById('rememberLabel').textContent = params.get('rememberLabel') || 'Recordar esta decisión';

document.getElementById('allow').addEventListener('click', () => {
  window.api.respond('allow', document.getElementById('remember').checked);
});
document.getElementById('deny').addEventListener('click', () => {
  window.api.respond('deny', document.getElementById('remember').checked);
});
