(function () {
  if (document.cookie.split("; ").some(function (entry) {
    return entry.indexOf("sketchycut_shell_access=1") === 0;
  })) {
    document.documentElement.classList.add("sketchycut-shell-authenticated");
  }
})();
