#!/bin/sh
set -eu

index_key='pietra:pipeline:runs'

assert_not_indexed() {
  member=$1
  score=$(redis-cli -h "$REDIS_HOST" --raw ZSCORE "$index_key" "$member")
  if [ -n "$score" ]; then
    echo "expected $member to be removed from $index_key, found score $score" >&2
    exit 1
  fi
}

assert_not_indexed missing-run
assert_not_indexed dashboard-expired-completed
assert_not_indexed dashboard-expired-failed

assert_hash_field() {
  key=$1
  field=$2
  expected=$3
  type=$(redis-cli -h "$REDIS_HOST" --raw TYPE "$key")
  if [ "$type" != 'hash' ]; then
    echo "expected retained HASH $key, found type $type" >&2
    exit 1
  fi

  actual=$(redis-cli -h "$REDIS_HOST" --raw HGET "$key" "$field")
  if [ "$actual" != "$expected" ]; then
    echo "expected $key $field=$expected, found $actual" >&2
    exit 1
  fi
}

completed_key='pietra:pipeline:run:dashboard-expired-completed'
assert_hash_field "$completed_key" id dashboard-expired-completed
assert_hash_field "$completed_key" status COMPLETED
assert_hash_field "$completed_key" expiresAt 1

failed_key='pietra:pipeline:run:dashboard-expired-failed'
assert_hash_field "$failed_key" id dashboard-expired-failed
assert_hash_field "$failed_key" status FAILED
assert_hash_field "$failed_key" expiresAt 1

completed_node_id='expired-completed-node'
completed_nodes_key="${completed_key}:nodes"
completed_node_score=$(redis-cli -h "$REDIS_HOST" --raw ZSCORE \
  "$completed_nodes_key" "$completed_node_id")
if [ "$completed_node_score" != '1' ]; then
  echo "expected retained node index score 1, found $completed_node_score" >&2
  exit 1
fi

completed_node_key="${completed_key}:node:${completed_node_id}"
assert_hash_field "$completed_node_key" id "$completed_node_id"
assert_hash_field "$completed_node_key" runId dashboard-expired-completed
assert_hash_field "$completed_node_key" status COMPLETED
assert_hash_field "$completed_node_key" stepName retention-checkpoint

running_score=$(redis-cli -h "$REDIS_HOST" --raw ZSCORE \
  "$index_key" dashboard-expired-running)
if [ "$running_score" != '2000000' ]; then
  echo "expected expired RUNNING member score 2000000, found $running_score" >&2
  exit 1
fi

remaining=$(redis-cli -h "$REDIS_HOST" --raw ZCARD "$index_key")
if [ "$remaining" != '109' ]; then
  echo "expected 109 retained run index members, found $remaining" >&2
  exit 1
fi

echo 'real Redis stale-index cleanup and expired RUNNING retention passed'
