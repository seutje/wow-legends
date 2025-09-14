function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else if (typeof v === 'boolean') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function cardTooltip(card) {
  const tooltip = el('div', { class: 'card-tooltip' });
  const art = new Image();
  art.className = 'card-art';
  art.alt = card.name;
  {
    let triedOptim = false;
    art.onerror = () => {
      if (!triedOptim) {
        triedOptim = true;
        art.src = `src/assets/art/${card.id}-art.png`;
      } else {
        art.remove();
      }
    };
    art.src = `src/assets/optim/${card.id}-art.png`;
  }
  const frame = new Image();
  frame.className = 'card-frame';
  frame.src = 'src/assets/frame.png';
  const infoChildren = [
    el('div', { class: 'card-type' }, card.type),
    el('h4', {}, card.name),
    el('p', { class: 'card-text' }, card.text)
  ];
  if (card.keywords?.length) {
    infoChildren.push(el('p', { class: 'card-keywords' }, card.keywords.join(', ')));
  }
  const info = el('div', { class: 'card-info' }, ...infoChildren);
  tooltip.append(art, frame, info);
  if (card.type === 'hero' && card.data?.armor != null) {
    tooltip.append(el('div', { class: 'stat armor' }, card.data.armor));
  } else if (card.cost != null) {
    tooltip.append(el('div', { class: 'stat cost' }, card.cost));
  }
  if (card.data?.attack != null) tooltip.append(el('div', { class: 'stat attack' }, card.data.attack));
  if (card.data?.health != null) tooltip.append(el('div', { class: 'stat health' }, card.data.health));
  return tooltip;
}

export { el };
