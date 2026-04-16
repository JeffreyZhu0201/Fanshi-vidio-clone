'use strict';

const { Op } = require('sequelize');

const DEMO_IDS = {
  project: 900000001,
  video: 900000001,
  segment: 900000001,
  task: 900000001
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert('projects', [
      {
        id: DEMO_IDS.project,
        user_id: null,
        name: 'Demo Video Clone Project',
        description: 'Seeded project for local database verification.',
        status: 'draft',
        created_at: now,
        updated_at: now
      }
    ]);

    await queryInterface.bulkInsert('videos', [
      {
        id: DEMO_IDS.video,
        project_id: DEMO_IDS.project,
        filename: 'demo-video.mp4',
        file_path: 'uploads/videos/demo-video.mp4',
        duration: 12,
        file_size: 1048576,
        status: 'uploaded',
        created_at: now,
        updated_at: now
      }
    ]);

    await queryInterface.bulkInsert('analyses', [
      {
        video_id: DEMO_IDS.video,
        plot: 'Seeded plot summary for local development.',
        characters: JSON.stringify([{ id: 'char_1', name: '主角' }]),
        backgrounds: JSON.stringify([{ id: 'bg_1', description: '室内场景' }]),
        time_anchors: JSON.stringify([
          {
            startTime: 0,
            endTime: 6,
            sceneSummary: '角色进入场景'
          }
        ]),
        gemini_response: 'Seeded Gemini response placeholder.',
        created_at: now,
        updated_at: now
      }
    ]);

    await queryInterface.bulkInsert('segments', [
      {
        id: DEMO_IDS.segment,
        video_id: DEMO_IDS.video,
        segment_index: 0,
        start_time: 0,
        end_time: 6,
        file_path: 'uploads/segments/demo-segment-0.mp4',
        analysis: JSON.stringify({
          characters: ['主角'],
          action: '进入场景'
        }),
        created_at: now,
        updated_at: now
      }
    ]);

    await queryInterface.bulkInsert('generation_tasks', [
      {
        id: DEMO_IDS.task,
        segment_id: DEMO_IDS.segment,
        prompt: 'Seeded prompt for demo generation task.',
        optimized_prompt: '@主角 走进室内场景，镜头平稳推进。',
        status: 'pending',
        result_url: null,
        progress: 0,
        error_message: null,
        created_at: now,
        updated_at: now
      }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('generation_tasks', {
      id: {
        [Op.in]: [DEMO_IDS.task]
      }
    });

    await queryInterface.bulkDelete('segments', {
      id: {
        [Op.in]: [DEMO_IDS.segment]
      }
    });

    await queryInterface.bulkDelete('analyses', {
      video_id: {
        [Op.in]: [DEMO_IDS.video]
      }
    });

    await queryInterface.bulkDelete('videos', {
      id: {
        [Op.in]: [DEMO_IDS.video]
      }
    });

    await queryInterface.bulkDelete('projects', {
      id: {
        [Op.in]: [DEMO_IDS.project]
      }
    });
  }
};
