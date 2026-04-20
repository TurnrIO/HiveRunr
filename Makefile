.PHONY: dev build install test

# Continuously rebuild the frontend into app/static/dist/ as files change.
# FastAPI's --reload picks up the updated HTML/JS immediately.
dev:
	cd frontend && npm run dev

# One-off production build into app/static/dist/
build:
	cd frontend && npm run build

# Install / update npm dependencies (run after pulling changes to package.json)
install:
	cd frontend && npm install

# Run the Python test suite
test:
	python -m pytest tests/ --ignore=tests/integration -q
