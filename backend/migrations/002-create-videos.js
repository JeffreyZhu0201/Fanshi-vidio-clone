'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('videos', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      project_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      filename: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      file_path: {
        type: Sequelize.STRING(500),
        allowNull: false
      },
      duration: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true
      },
      file_size: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('uploaded', 'analyzing', 'analyzed', 'failed'),
        allowNull: false,
        defaultValue: 'uploaded'
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

    await queryInterface.addIndex('videos', ['project_id'], {
      name: 'videos_project_id_idx'
    });

    await queryInterface.addIndex('videos', ['status'], {
      name: 'videos_status_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('videos');
  }
};
