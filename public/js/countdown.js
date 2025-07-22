(() => {
  const countEl = document.getElementById('countdown');
  const target = new Date('2026-04-20T16:20:00-05:00');
  function update(){
    const now = new Date();
    const diff = target - now;
    if(diff <= 0){
      countEl.textContent = "Presale live!";
      clearInterval(timer);
      return;
    }
    const d = Math.floor(diff / 864e5);
    const h = Math.floor(diff % 864e5 / 36e5);
    const m = Math.floor(diff % 36e5 / 6e4);
    const s = Math.floor(diff % 6e4 / 1000);
    countEl.textContent = `${d}d ${h}h ${m}m ${s}s until presale ends`;
  }
  update();
  const timer = setInterval(update, 1000);
})();
