.DEFAULT_GOAL := help
.PHONY: help install test test-watch coverage lint build smoke update update-latest

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

test: ## Run unit tests, plus the API smoke test if RIKA credentials are set
	npm test
	@set -a; [ -f .env ] && . ./.env; set +a; \
	missing=; \
	[ -n "$$STOVE_ID" ] || missing="$$missing STOVE_ID"; \
	[ -n "$$RIKA_EMAIL" ] || missing="$$missing RIKA_EMAIL"; \
	[ -n "$$RIKA_PASSWORD" ] || missing="$$missing RIKA_PASSWORD"; \
	if [ -z "$$missing" ]; then \
		echo "==> Credentials detected, running API smoke test"; \
		$(MAKE) --no-print-directory smoke; \
	else \
		echo "==> Skipping API smoke test: missing environment variable(s):$$missing"; \
		echo "    Set STOVE_ID, RIKA_EMAIL and RIKA_PASSWORD (export them or put them in .env) to enable it."; \
	fi

test-watch: ## Run the tests in watch mode
	npm run test:watch

coverage: ## Run the tests with a coverage report
	npm run test:coverage

lint: ## Lint the source and tests
	npm run lint

build: ## Compile TypeScript to dist/
	npm run build

smoke: build ## Run the read-only API smoke test against a real stove
	@set -a; [ -f .env ] && . ./.env; set +a; \
	node scripts/smoke-test.mjs

update: ## Update dependencies within the ranges in package.json
	npm update
	npm install

update-latest: ## Upgrade all dependencies to their latest versions
	npx --yes npm-check-updates -u
	npm install
