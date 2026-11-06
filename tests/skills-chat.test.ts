import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickChatSkills, chatSkillBlock } from '../src/lib/skills';

const skill = (over: Record<string, unknown> = {}) => ({
  name: 'Founder Update',
  description: 'Use when the user asks for an investor, funder or stakeholder update.',
  instructions: 'Structure: TL;DR, Wins, Challenges, Ask.',
  enabled: true,
  modes: ['chat', 'cowork'] as Array<'chat' | 'cowork' | 'code'>,
  ...over,
});

describe('Chat skills are applied by relevance', () => {
  it('picks a skill whose description matches the request', () => {
    const picked = pickChatSkills([skill()], 'Write a quick investor update for this month');
    assert.equal(picked.length, 1);
    assert.match(chatSkillBlock(picked), /TL;DR/);
  });
  it('picks a skill named in the prompt', () => {
    assert.equal(pickChatSkills([skill()], 'use the founder update skill').length, 1);
  });
  it('ignores unrelated prompts, disabled skills and skills not enabled for chat', () => {
    assert.equal(pickChatSkills([skill()], 'What is the capital of Lagos state?').length, 0);
    assert.equal(pickChatSkills([skill({ enabled: false })], 'investor update please').length, 0);
    assert.equal(pickChatSkills([skill({ modes: ['code'] })], 'investor update please').length, 0);
  });
  it('caps at two skills and returns an empty block for none', () => {
    const many = [skill({ name: 'A update' }), skill({ name: 'B update' }), skill({ name: 'C update' })];
    assert.equal(pickChatSkills(many, 'investor update funder').length, 2);
    assert.equal(chatSkillBlock([]), '');
  });
});
