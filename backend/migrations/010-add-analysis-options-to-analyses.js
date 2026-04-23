'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('analyses', 'analysis_options', {
      type: Sequelize.JSON,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('analyses', 'analysis_options');
  }
};
