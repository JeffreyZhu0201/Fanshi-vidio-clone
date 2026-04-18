'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('background_assets', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      video_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'videos',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      background_id: {
        type: Sequelize.STRING(191),
        allowNull: false
      },
      asset_type: {
        type: Sequelize.STRING(64),
        allowNull: false,
        defaultValue: 'reference_video'
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending'
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT('long'),
        allowNull: true
      },
      scene_prompt: {
        type: Sequelize.TEXT('long'),
        allowNull: true
      },
      asset_path: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      asset_url: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      source_segment_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: {
          model: 'segments',
          key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      representative_frame_time: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
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
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('background_assets', ['video_id'], {
      name: 'background_assets_video_id_idx'
    });

    await queryInterface.addIndex('background_assets', ['video_id', 'background_id'], {
      name: 'background_assets_video_background_unique',
      unique: true
    });

    await queryInterface.addIndex('background_assets', ['status'], {
      name: 'background_assets_status_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('background_assets');
  }
};
