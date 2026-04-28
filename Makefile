.PHONY: build test check clean package package-all publish publish-all

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

publish: package
	node scripts/publish-vsix.mjs $(TARGET)

publish-all: package-all
	node scripts/publish-vsix.mjs --all
