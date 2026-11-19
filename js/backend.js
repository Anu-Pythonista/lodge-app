// Connects the app to Firebase (Google sign-in + Firestore).
// app.js talks to the small API defined at the bottom of this file.
(function () {
  "use strict";

  var cfg = window.LODGE_CONFIG || {};
  var fb = cfg.firebase || {};

  // No Firebase settings yet: app.js shows a "not connected" message.
  if (!fb.apiKey || typeof firebase === "undefined") {
    window.lodgeBackend = { use: function () { return Promise.resolve(null); } };
    return;
  }

  firebase.initializeApp(fb);
  var auth = firebase.auth();
  var store = firebase.firestore();

  var staffEmails = (cfg.staffEmails || []).map(function (e) {
    return String(e).toLowerCase();
  });

  function isStaff(u) {
    return !!(u && u.email && staffEmails.indexOf(u.email.toLowerCase()) !== -1);
  }

  // Resolves once with the signed-in user (or null) when Firebase has checked.
  var ready = new Promise(function (resolve) {
    var off = auth.onAuthStateChanged(function (u) {
      off();
      resolve(u);
    });
  });

  var user = {
    isOwner: function () { return ready.then(isStaff); },
    canEdit: function () { return ready.then(isStaff); },
    can: function () { return ready.then(function (u) { return !!u; }); },
    id: function () { return ready.then(function (u) { return u ? u.uid : null; }); }
  };

  var db = {
    collection: function (path) { return store.collection(path); },
    doc: function (path) { return store.doc(path); }
  };

  var downloads = {
    save: function (file) {
      return new Promise(function (resolve, reject) {
        try {
          var blob = new Blob([file.data], { type: "text/html" });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = file.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          resolve({ status: "saved" });
        } catch (e) {
          reject({ code: "unavailable", message: String(e) });
        }
      });
    }
  };

  window.lodgeBackend = {
    use: function (name) {
      if (name === "user") return Promise.resolve(user);
      if (name === "db") return Promise.resolve(db);
      if (name === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };

  // Sign in / sign out button in the page header.
  ready.then(function (u) {
    var header = document.querySelector("header.top");
    if (!header) return;
    var box = document.createElement("div");
    box.className = "row";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm";

    if (u) {
      var who = document.createElement("span");
      who.className = "small muted";
      who.textContent = u.displayName || u.email || "Signed in";
      box.appendChild(who);
      btn.textContent = "Sign out";
      btn.addEventListener("click", function () {
        auth.signOut().then(function () { location.reload(); });
      });
    } else {
      btn.textContent = "Sign in with Google";
      btn.addEventListener("click", function () {
        auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
          .then(function () { location.reload(); })
          .catch(function (e) { alert("Sign-in failed: " + e.code); });
      });
    }
    box.appendChild(btn);
    header.appendChild(box);
  });
})();
