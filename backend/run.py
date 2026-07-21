import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    # Keep the default localhost command single-process and predictable. Opt in
    # to Flask's debugger/reloader explicitly when it is actually needed.
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=debug)
