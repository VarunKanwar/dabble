.PHONY: build test check clean package

build:
	npm run build

test:
	npm test

check:
	npm run check

clean:
	rm -rf dist/

package: check
	npx @vscode/vsce package --no-dependencies
