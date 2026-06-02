.DEFAULT_GOAL := help
.PHONY: help install test test-watch coverage lint build update update-latest

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

test: ## Run the unit test suite
	npm test

test-watch: ## Run the tests in watch mode
	npm run test:watch

coverage: ## Run the tests with a coverage report
	npm run test:coverage

lint: ## Lint the source and tests
	npm run lint

build: ## Compile TypeScript to dist/
	npm run build

update: ## Update dependencies within the ranges in package.json
	npm update
	npm install

update-latest: ## Upgrade all dependencies to their latest versions
	npx --yes npm-check-updates -u
	npm install
