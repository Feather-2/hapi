import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listSkills } from './skills';

describe('skills', () => {
    const originalCodexHome = process.env.CODEX_HOME;
    const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    let codexHome: string;

    beforeEach(async () => {
        codexHome = await mkdtemp(join(tmpdir(), 'hapi-skills-'));
        process.env.CODEX_HOME = codexHome;
    });

    afterEach(async () => {
        if (originalCodexHome === undefined) {
            delete process.env.CODEX_HOME;
        } else {
            process.env.CODEX_HOME = originalCodexHome;
        }
        if (originalClaudeConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
        }
        await rm(codexHome, { recursive: true, force: true });
    });

    it('returns empty list when skills directory is missing', async () => {
        const skills = await listSkills('codex');
        expect(skills).toEqual([]);
    });

    it('lists only top-level skills and .system children', async () => {
        const skillsRoot = join(codexHome, 'skills');
        await mkdir(skillsRoot, { recursive: true });

        const amisDir = join(skillsRoot, 'amis');
        await mkdir(amisDir, { recursive: true });
        await writeFile(join(amisDir, 'SKILL.md'), [
            '---',
            'name: amis',
            'description: AMIS guide',
            '---',
            '',
            '# AMIS',
        ].join('\n'));

        const helloAgentsDir = join(skillsRoot, 'hello-agents');
        await mkdir(join(helloAgentsDir, 'analyze'), { recursive: true });
        await writeFile(join(helloAgentsDir, 'SKILL.md'), [
            '---',
            'name: helloagents',
            'description: Main skill',
            '---',
            '',
            '# HelloAGENTS',
        ].join('\n'));
        await writeFile(join(helloAgentsDir, 'analyze', 'SKILL.md'), [
            '---',
            'name: analyze',
            'description: Sub skill',
            '---',
            '',
            '# Analyze',
        ].join('\n'));

        const systemRoot = join(skillsRoot, '.system');
        const systemSkillDir = join(systemRoot, 'skill-creator');
        await mkdir(systemSkillDir, { recursive: true });
        await writeFile(join(systemSkillDir, 'SKILL.md'), [
            '---',
            'name: skill-creator',
            'description: Create skills',
            '---',
            '',
            '# Skill Creator',
        ].join('\n'));

        const skills = await listSkills('codex');
        expect(skills.map((s) => s.name)).toEqual(['amis', 'helloagents', 'skill-creator']);
    });

    it('falls back to directory name when frontmatter is missing', async () => {
        const skillsRoot = join(codexHome, 'skills');
        const fallbackDir = join(skillsRoot, 'no-frontmatter');
        await mkdir(fallbackDir, { recursive: true });
        await writeFile(join(fallbackDir, 'SKILL.md'), '# No Frontmatter\n');

        const skills = await listSkills('codex');
        expect(skills).toEqual([{ name: 'no-frontmatter', description: undefined }]);
    });

    it('reads Claude skills from CLAUDE_CONFIG_DIR', async () => {
        const claudeHome = await mkdtemp(join(tmpdir(), 'hapi-claude-skills-'));
        process.env.CLAUDE_CONFIG_DIR = claudeHome;
        const skillsRoot = join(claudeHome, 'skills');
        const testDir = join(skillsRoot, 'checkpoint');
        await mkdir(testDir, { recursive: true });
        await writeFile(join(testDir, 'SKILL.md'), [
            '---',
            'name: checkpoint',
            'description: Session continuity',
            '---',
            '',
            '# Checkpoint',
        ].join('\n'));

        const skills = await listSkills('claude');
        expect(skills).toEqual([{ name: 'checkpoint', description: 'Session continuity' }]);

        delete process.env.CLAUDE_CONFIG_DIR;
        await rm(claudeHome, { recursive: true, force: true });
    });
});

