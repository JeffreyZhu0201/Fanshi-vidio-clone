'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shot_generation_tasks', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      segment_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'segments',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      shot_id: {
        type: Sequelize.STRING(191),
        allowNull: false
      },
      shot_index: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      prompt: {
        type: Sequelize.TEXT('long'),
        allowNull: false
      },
      optimized_prompt: {
        type: Sequelize.TEXT('long'),
        allowNull: true
      },
      start_time: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      end_time: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      duration_seconds: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending'
      },
      result_url: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      progress: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      meta: {
        type: Sequelize.JSON,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('shot_generation_tasks', ['segment_id'], {
      name: 'shot_generation_tasks_segment_id_idx'
    });
    await queryInterface.addIndex('shot_generation_tasks', ['status'], {
      name: 'shot_generation_tasks_status_idx'
    });
    await queryInterface.addIndex('shot_generation_tasks', ['segment_id', 'shot_id'], {
      name: 'shot_generation_tasks_segment_shot_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shot_generation_tasks');
  }
};
