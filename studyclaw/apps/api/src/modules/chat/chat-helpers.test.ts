import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStreamingHeartbeatMessage, buildStreamingProgressMessages, inferChatRequestStrategy } from './chat-helpers';

test('inferChatRequestStrategy treats Gmail capability questions as Google status requests', () => {
  const strategy = inferChatRequestStrategy({
    message: 'Do you have Gmail access right now?',
    studyMode: 'chat',
    hasAttachments: false,
  });

  assert.equal(strategy.googleStatusRequest, true);
  assert.equal(strategy.contextScope, 'targeted');
});

test('buildStreamingProgressMessages uses Gmail-specific live status copy', () => {
  const strategy = inferChatRequestStrategy({
    message: 'Send an email to dixieloveswillow@gmail.com subject Hey body Hello',
    studyMode: 'chat',
    hasAttachments: false,
  });

  const messages = buildStreamingProgressMessages({
    agentName: 'Dixie',
    message: 'Send an email to dixieloveswillow@gmail.com subject Hey body Hello',
    studyMode: 'chat',
    hasAttachments: false,
    strategy,
  });

  assert.deepEqual(messages, [
    'Dixie is thinking...',
    'Using Gmail tools...',
    'Preparing that email through your connected Google account...',
  ]);
});

test('buildStreamingHeartbeatMessage keeps Google workspace tool activity visible', () => {
  const strategy = inferChatRequestStrategy({
    message: 'Show my recent Google Docs',
    studyMode: 'chat',
    hasAttachments: false,
  });

  assert.equal(
    buildStreamingHeartbeatMessage({
      agentName: 'Willow',
      message: 'Show my recent Google Docs',
      studyMode: 'chat',
      strategy,
      tick: 1,
    }),
    'Checking which connected Google files are available...'
  );

  assert.equal(
    buildStreamingHeartbeatMessage({
      agentName: 'Willow',
      message: 'Show my recent Google Docs',
      studyMode: 'chat',
      strategy,
      tick: 2,
    }),
    'Still using Google Workspace tools...'
  );
});
