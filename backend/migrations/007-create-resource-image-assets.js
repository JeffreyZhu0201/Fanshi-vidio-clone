'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('resource_image_assets', {
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
      resource_type: {
        type: Sequelize.ENUM('character', 'scene'),
        allowNull: false
      },
      resource_id: {
        type: Sequelize.STRING(191),
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      variant_id: {
        type: Sequelize.STRING(64),
        allowNull: false
      },
      variant_label: {
        type: Sequelize.STRING(64),
        allowNull: false
      },
      sort_order: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      source_prompt: {
        type: Sequelize.TEXT('long'),
        allowNull: true
      },
      prompt: {
        type: Sequelize.TEXT('long'),
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending'
      },
      asset_path: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      asset_url: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      mime_type: {
        type: Sequelize.STRING(64),
        allowNull: true
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

    await queryInterface.addIndex('resource_image_assets', ['video_id'], {
      name: 'resource_image_assets_video_id_idx'
    });

    await queryInterface.addIndex('resource_image_assets', ['video_id', 'resource_type', 'resource_id', 'variant_id'], {
      name: 'resource_image_assets_video_resource_variant_unique',
      unique: true
    });

    await queryInterface.addIndex('resource_image_assets', ['status'], {
      name: 'resource_image_assets_status_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('resource_image_assets');
  }
};
