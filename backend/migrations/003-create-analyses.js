'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('analyses', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      video_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true,
        references: {
          model: 'videos',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      plot: {
        type: Sequelize.TEXT('long'),
        allowNull: true
      },
      characters: {
        type: Sequelize.JSON,
        allowNull: true
      },
      backgrounds: {
        type: Sequelize.JSON,
        allowNull: true
      },
      time_anchors: {
        type: Sequelize.JSON,
        allowNull: true
      },
      gemini_response: {
        type: Sequelize.TEXT('long'),
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

    await queryInterface.addIndex('analyses', ['video_id'], {
      name: 'analyses_video_id_unique',
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('analyses');
  }
};
