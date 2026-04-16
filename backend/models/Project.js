import { DataTypes } from 'sequelize';

import { PROJECT_STATUS, PROJECT_STATUS_VALUES } from '../config/constants.js';

const defineProjectModel = (sequelize) => {
  const Project = sequelize.define(
    'Project',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      userId: {
        field: 'user_id',
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
        validate: {
          min: 1
        }
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 255]
        }
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM(...PROJECT_STATUS_VALUES),
        allowNull: false,
        defaultValue: PROJECT_STATUS.draft
      }
    },
    {
      tableName: 'projects',
      indexes: [
        {
          name: 'projects_user_id_idx',
          fields: ['user_id']
        },
        {
          name: 'projects_status_idx',
          fields: ['status']
        }
      ]
    }
  );

  Project.associate = ({ Video }) => {
    if (Video) {
      Project.hasMany(Video, {
        foreignKey: 'projectId',
        as: 'videos',
        onDelete: 'CASCADE',
        hooks: true
      });
    }
  };

  return Project;
};

export default defineProjectModel;
