import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleWorkspaceIntent } from './chat-fastpaths';

test('parseGoogleWorkspaceIntent parses Gmail send with explicit subject/body format', () => {
  const intent = parseGoogleWorkspaceIntent('Send an email to dixieloveswillow@gmail.com subject Hey body Hello');

  assert.deepEqual(intent, {
    action: 'send_gmail',
    to: 'dixieloveswillow@gmail.com',
    subject: 'Hey',
    bodyText: 'Hello',
  });
});

test('parseGoogleWorkspaceIntent parses Gmail send with empty subject and natural body phrasing', () => {
  const intent = parseGoogleWorkspaceIntent(
    'Send an email to dixieloveswillow@gmail.com leave the subject empty and just say hey how are you'
  );

  assert.deepEqual(intent, {
    action: 'send_gmail',
    to: 'dixieloveswillow@gmail.com',
    subject: '',
    bodyText: 'hey how are you',
  });
});

test('parseGoogleWorkspaceIntent parses Gmail send with no-subject phrasing', () => {
  const intent = parseGoogleWorkspaceIntent(
    'Write an email to dixieloveswillow@gmail.com no subject and say checking in before class'
  );

  assert.deepEqual(intent, {
    action: 'send_gmail',
    to: 'dixieloveswillow@gmail.com',
    subject: '',
    bodyText: 'checking in before class',
  });
});

test('parseGoogleWorkspaceIntent parses follow-up Gmail send using recent thread history', () => {
  const intent = parseGoogleWorkspaceIntent('Send another one that says poopyface', {
    history:
      'Send an email to dixieloveswillow@gmail.com leave the subject empty and just say hey how are you\nI sent that email to dixieloveswillow@gmail.com with an empty subject line.',
  });

  assert.deepEqual(intent, {
    action: 'send_gmail',
    to: 'dixieloveswillow@gmail.com',
    subject: '',
    bodyText: 'poopyface',
  });
});

test('parseGoogleWorkspaceIntent parses follow-up Gmail send with message phrasing', () => {
  const intent = parseGoogleWorkspaceIntent('Send them another message that says what time is the interview tomorrow', {
    history:
      'Send an email to dixieloveswillow@gmail.com leave the subject empty and just say hey how are you\nI sent that email to dixieloveswillow@gmail.com with an empty subject line.',
  });

  assert.deepEqual(intent, {
    action: 'send_gmail',
    to: 'dixieloveswillow@gmail.com',
    subject: '',
    bodyText: 'what time is the interview tomorrow',
  });
});
