export function SiteFooter() {
  const lastSyncDate = process.env.SKETCHYCUT_LAST_SYNC_DATE ?? "unknown";

  return (
    <footer className="site-footer">
      <p>
        SketchyCut by @earlyspark on <a
          href="https://github.com/earlyspark/sketchycut"
          target="_blank"
          rel="noopener noreferrer"
        >github</a> for <a
          href="https://openai.com/build-week/"
          target="_blank"
          rel="noopener noreferrer"
        >OpenAI Build Week 2026</a>
      </p>
      <p className="shell-authenticated-only">
        <a href="/create">Judge Access Unlocked</a>
        {" | updated on: "}
        <time dateTime={lastSyncDate}>{lastSyncDate}</time>
      </p>
      <details className="judge-access shell-public-only">
        <summary>
          <span>Judge Access</span>
          {" | updated on: "}
          <time dateTime={lastSyncDate}>{lastSyncDate}</time>
        </summary>
        <form action="/api/session" method="post" data-lpignore="true" data-1p-ignore="true" data-bwignore="true">
          <label className="sr-only" htmlFor="judge-access-code">Access code</label>
          <input
            id="judge-access-code"
            className="masked-access-code"
            name="accessCode"
            type="text"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            required
          />
          <button type="submit">Submit</button>
        </form>
      </details>
    </footer>
  );
}
