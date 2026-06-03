#!/bin/bash
# classify.sh — pure string classifier for the command-gate hook.
# Echoes exactly one of: test_raw | test_wrapped | important | none

TEST_RUNNERS='go test|gotestsum|pytest|python -m pytest|npm test|npm run test|yarn test|pnpm test|jest|vitest|cargo test|make test|mvn test|gradle test|dotnet test|rspec'
DESTRUCTIVE='rm -rf|git push --force|git push -f|git reset --hard|git clean -fd|truncate |mkfs|dd if=|chmod -R'
PUBLISH='git push|gh pr merge|npm publish|docker push|terraform apply|terraform destroy|kubectl delete|helm upgrade'
APIKEY='ALLOW_REAL_API_TESTS=1'

classify() {
  local cmd="$1"

  # Escape hatch / explicit real-credential use is always important.
  if printf '%s' "$cmd" | grep -Eq "($APIKEY)"; then echo important; return; fi

  if printf '%s' "$cmd" | grep -Eq "($TEST_RUNNERS)"; then
    if printf '%s' "$cmd" | grep -Eq '(^|[^a-zA-Z0-9_/-])safe-test '; then
      echo test_wrapped; return
    fi
    echo test_raw; return
  fi

  if printf '%s' "$cmd" | grep -Eq "($DESTRUCTIVE|$PUBLISH)"; then
    echo important; return
  fi

  echo none
}
