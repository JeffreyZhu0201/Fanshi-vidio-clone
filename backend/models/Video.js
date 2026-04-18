import { DataTypes } from 'sequelize';

import { VIDEO_STATUS, VIDEO_STATUS_VALUES } from '../config/constants.js';

const defineVideoModel = (sequelize) => {
  const Video = sequelize.define(
    'Video',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      projectId: {
        field: 'project_id',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id'
        }
      },
      filename: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 255]
        }
      },
      filePath: {
        field: 'file_path',
        type: DataTypes.STRING(500),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 500]
        }
      },
      duration: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
        validate: {
          min: 0
        }
      },
      fileSize: {
        field: 'file_size',
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
        validate: {
          min: 0
        }
      },
      status: {
        type: DataTypes.ENUM(...VIDEO_STATUS_VALUES),
        allowNull: false,
        defaultValue: VIDEO_STATUS.uploaded
      }
    },
    {
      tableName: 'videos',
      indexes: [
        {
          name: 'videos_project_id_idx',
          fields: ['project_id']
        },
        {
          name: 'videos_status_idx',
          fields: ['status']
        }
      ]
    }
  );

  Video.associate = ({ Project, Analysis, BackgroundAsset, Segment }) => {
    if (Project) {
      Video.belongsTo(Project, {
        foreignKey: 'projectId',
        as: 'project',
        onDelete: 'CASCADE'
      });
    }

    if (Analysis) {
      Video.hasOne(Analysis, {
        foreignKey: 'videoId',
        as: 'analysis',
        onDelete: 'CASCADE',
        hooks: true
      });
    }

    if (Segment) {
      Video.hasMany(Segment, {
        foreignKey: 'videoId',
        as: 'segments',
        onDelete: 'CASCADE',
        hooks: true
      });
    }

    if (BackgroundAsset) {
      Video.hasMany(BackgroundAsset, {
        foreignKey: 'videoId',
        as: 'backgroundAssets',
        onDelete: 'CASCADE',
        hooks: true
      });
    }
  };

  return Video;
};

export default defineVideoModel;
