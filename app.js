// Black Calf QR menu — renders menu.json. No build step, no tracking.
(function () {
  "use strict";
  var LANGS = ["az", "ru", "en"];
  var UI = {
    az: { demo: "DEMO MENYU — qiymətlər təxminidir", save: "Qənaət", separately: "Ayrı-ayrılıqda", allergens: "Allergenlər", g: "q", ml: "ml",
          hero: "İmza dürüm", whatsapp: "WhatsApp", call: "Zəng et", route: "Marşrut", instagram: "Instagram", version: "Versiya", from: "", until: "bağlanana qədər", choose: "seçim" },
    ru: { demo: "ДЕМО-МЕНЮ — цены ориентировочные", save: "Выгода", separately: "По отдельности", allergens: "Аллергены", g: "г", ml: "мл",
          hero: "Фирменный дюрюм", whatsapp: "WhatsApp", call: "Позвонить", route: "Маршрут", instagram: "Instagram", version: "Версия", from: "с", until: "до закрытия", choose: "на выбор" },
    en: { demo: "DEMO MENU — prices are indicative", save: "You save", separately: "Separately", allergens: "Allergens", g: "g", ml: "ml",
          hero: "Signature dürüm", whatsapp: "WhatsApp", call: "Call", route: "Directions", instagram: "Instagram", version: "Version", from: "from", until: "until closing", choose: "choice" }
  };
  var HIDDEN_TAGS = { halal_tbd: 1, hero: 1 };
  var M = null, lang = pickLang();

  function pickLang() {
    var q = new URLSearchParams(location.search).get("lang");
    if (LANGS.indexOf(q) >= 0) return q;
    try { var s = localStorage.getItem("bc-lang"); if (LANGS.indexOf(s) >= 0) return s; } catch (e) {}
    var nav = (navigator.languages || [navigator.language || ""]);
    for (var i = 0; i < nav.length; i++) { var p = String(nav[i]).slice(0, 2).toLowerCase(); if (LANGS.indexOf(p) >= 0) return p; }
    return "az";
  }
  function t(obj) { return obj ? (obj[lang] || obj.az || obj.ru || obj.en || "") : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(v) {
    if (v == null) return "";
    var s = (Math.round(v * 100) / 100).toFixed(2);
    if (s.slice(-3) === ".00") s = s.slice(0, -3);
    if (lang !== "en") s = s.replace(".", ",");
    return s + " ₼";
  }
  function splitName(n) { var i = n.indexOf(" — "); return i > 0 ? [n.slice(0, i), n.slice(i + 3)] : [n, ""]; }
  function chili(n) { return n > 0 ? '<span class="chili" title="' + n + '/3">' + "🌶".repeat(n) + "</span>" : ""; }
  function size(it) {
    if (it.volume_ml) return it.volume_ml >= 1000 ? (it.volume_ml / 1000) + " l" : it.volume_ml + " " + UI[lang].ml;
    if (it.weight_g) return "~" + it.weight_g + " " + UI[lang].g;
    return "";
  }
  function tags(it) {
    return (it.tags || []).filter(function (x) { return !HIDDEN_TAGS[x]; }).slice(0, 2).map(function (x) {
      var label = t((M.tag_labels || {})[x]) || x;
      return '<span class="tag ' + esc(x) + '">' + esc(label) + "</span>";
    }).join("");
  }
  function allergens(list) {
    if (!list || !list.length) return "";
    var legend = M.allergen_legend || {};
    return '<div class="allergens">' + esc(UI[lang].allergens) + ": " + list.map(function (a) { return esc(t(legend[a]) || a); }).join(", ") + "</div>";
  }
  function variants(it) {
    if (!it.variants || !it.variants.length) return "";
    return '<div class="variants">' + it.variants.map(function (v) {
      var w = v.weight_g ? " · " + v.weight_g + " " + UI[lang].g : "";
      return '<span class="variant">' + esc(t(v.name)) + " <b>" + (it.is_addon ? "+" : "") + money(v.price) + "</b>" + esc(w) + "</span>";
    }).join("") + "</div>";
  }

  function heroCard(it) {
    var n = splitName(t(it.name));
    return '<article class="hero" id="item-' + esc(it.id) + '">' +
      '<div class="num">' + esc(it.number || "") + "</div>" +
      '<div class="kicker">' + esc(UI[lang].hero) + " · №" + esc(it.number || "") + "</div>" +
      "<h3>" + esc(n[0]) + "</h3>" + (n[1] ? '<div class="sub">' + esc(n[1]) + "</div>" : "") +
      '<p class="desc">' + esc(t(it.description)) + "</p>" +
      '<div class="row"><div class="price">' + money(it.price) + "</div>" +
      '<div class="phrase">' + esc(t((M.extras || {}).hero_phrase)) + "</div></div>" +
      '<div class="meta">' + tags(it) + chili(it.spicy_level) + (size(it) ? "<span>" + esc(size(it)) + "</span>" : "") + "</div>" +
      allergens(it.allergens) + "</article>";
  }

  function itemCard(it, isSet) {
    var n = splitName(t(it.name));
    var price = '<div class="price' + (it.is_addon ? " addon" : "") + '">' + (it.is_addon ? "+" : "") + money(it.price);
    if (isSet && it.price_separately) {
      price += '<span class="old" title="' + esc(UI[lang].separately) + '">' + money(it.price_separately) + "</span>";
      if (it.savings) price += '<span class="save">−' + money(it.savings) + "</span>";
    }
    price += "</div>";
    var avail = "";
    if (it.availability && it.availability.from) {
      avail = '<span class="avail">🌙 ' + esc(UI[lang].from) + " " + esc(it.availability.from) + " " + esc(it.availability.to === "close" ? UI[lang].until : it.availability.to) + "</span>";
    }
    var hasVariants = it.variants && it.variants.length;
    return '<article class="item' + (isSet ? " set" : "") + '" id="item-' + esc(it.id) + '">' +
      '<div class="num-badge">' + esc(it.number || "") + "</div>" +
      '<h3 class="name">' + esc(n[0]) + (n[1] ? '<span class="sub">' + esc(n[1]) + "</span>" : "") + "</h3>" +
      (hasVariants ? "<div></div>" : price) +
      '<p class="desc">' + esc(t(it.description)) + "</p>" +
      variants(it) +
      '<div class="meta">' + tags(it) + chili(it.spicy_level) + (size(it) && !hasVariants ? "<span>" + esc(size(it)) + "</span>" : "") + avail + "</div>" +
      allergens(it.allergens) + "</article>";
  }

  function render() {
    document.documentElement.lang = lang;
    document.querySelectorAll(".langs button").forEach(function (b) { b.classList.toggle("on", b.dataset.lang === lang); });
    var bar = document.getElementById("demoBar");
    bar.hidden = !M.is_demo; bar.textContent = UI[lang].demo;
    document.getElementById("welcome").textContent = t((M.extras || {}).welcome);

    var hero = null;
    M.categories.forEach(function (c) { c.items.forEach(function (it) { if (!hero && (it.tags || []).indexOf("hero") >= 0) hero = it; }); });

    var nav = "", html = hero ? heroCard(hero) : "";
    M.categories.forEach(function (c) {
      var items = c.items.filter(function (it) { return it !== hero; });
      if (!items.length) return;
      nav += '<a href="#cat-' + esc(c.id) + '" data-cat="' + esc(c.id) + '">' + esc(t(c.name)) + "</a>";
      html += '<section id="cat-' + esc(c.id) + '"><h2>' + esc(t(c.name)) + '</h2><div class="list">' +
        items.map(function (it) { return itemCard(it, !!it.set_items); }).join("") + "</div></section>";
    });
    document.getElementById("cats").innerHTML = nav;
    document.getElementById("menu").innerHTML = html;

    var ex = M.extras || {};
    document.getElementById("foot").innerHTML =
      (ex.loyalty ? '<div class="box">💛 <b>' + esc(t(ex.loyalty)) + "</b></div>" : "") +
      (ex.secret ? '<div class="box">🤫 ' + esc(t(ex.secret)) + "</div>" : "") +
      (M.notes ? '<div class="box">' + esc(t(M.notes)) + "</div>" : "") +
      '<div class="small">Black Calf · ' + esc(UI[lang].version) + " " + esc(M.version || "") + "</div>";

    var c = M.contact || {}, acts = "";
    if (c.whatsapp) acts += '<a class="primary" href="https://wa.me/' + encodeURIComponent(String(c.whatsapp).replace(/\D/g, "")) + '" rel="noopener">' + esc(UI[lang].whatsapp) + "</a>";
    if (c.phone) acts += '<a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, "")) + '">' + esc(UI[lang].call) + "</a>";
    if (c.maps_url) acts += '<a href="' + esc(c.maps_url) + '" rel="noopener">' + esc(UI[lang].route) + "</a>";
    if (c.instagram) acts += '<a href="https://instagram.com/' + encodeURIComponent(String(c.instagram).replace(/^@/, "")) + '" rel="noopener">' + esc(UI[lang].instagram) + "</a>";
    var a = document.getElementById("actions"); a.innerHTML = acts; a.hidden = !acts;
    spy();
  }

  var observer = null;
  function spy() {
    if (observer) observer.disconnect();
    if (!("IntersectionObserver" in window)) return;
    var links = {};
    document.querySelectorAll(".cats a").forEach(function (l) { links[l.dataset.cat] = l; });
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.id.replace("cat-", "");
        Object.keys(links).forEach(function (k) { links[k].classList.toggle("on", k === id); });
        var l = links[id]; if (l && l.scrollIntoView) { var nav = l.parentNode; nav.scrollTo({ left: l.offsetLeft - 16, behavior: "smooth" }); }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main section").forEach(function (s) { observer.observe(s); });
  }

  document.querySelectorAll(".langs button").forEach(function (b) {
    b.addEventListener("click", function () {
      lang = b.dataset.lang;
      try { localStorage.setItem("bc-lang", lang); } catch (e) {}
      if (M) render();
    });
  });

  fetch("menu.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) { M = data; render(); })
    .catch(function () { document.getElementById("menu").innerHTML = '<p class="loading">Menu could not load. Please refresh.</p>'; });
})();
