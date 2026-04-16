'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('segments', {
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
      segment_index: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false
      },
      start_time: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      end_time: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      file_path: {
        type: Sequelize.STRING(500),
        allowNull: false
      },
      analysis: {
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

    await queryInterface.addIndex('segments', ['video_id'], {
      name: 'segments_video_id_idx'
    });

    await queryInterface.addIndex('segments', ['video_id', 'segment_index'], {
      name: 'segments_video_id_segment_index_unique',
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('segments');
  }
};
