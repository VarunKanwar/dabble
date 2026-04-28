.PHONY: build test check clean package package-all

build:
	npm run build

test:
	npm test

check:
	npm run check

clean:
	rm -rf dist/ artifacts/

package: check
	node scripts/package-vsix.mjs $(TARGET)

package-all: check
	node scripts/package-vsix.mjs --all
