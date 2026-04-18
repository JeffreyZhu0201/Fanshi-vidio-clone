import { DataTypes } from 'sequelize';

const BACKGROUND_ASSET_STATUSES = ['pending', 'processing', 'completed', 'failed'];

const defineBackgroundAssetModel = (sequelize) => {
  const BackgroundAsset = sequelize.define(
    'BackgroundAsset',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      videoId: {
        field: 'video_id',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'videos',
          key: 'id'
        }
      },
      backgroundId: {
        field: 'background_id',
        type: DataTypes.STRING(191),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 191]
        }
      },
      assetType: {
        field: 'asset_type',
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'reference_video',
        validate: {
          notEmpty: true,
          len: [1, 64]
        }
      },
      status: {
        type: DataTypes.ENUM(...BACKGROUND_ASSET_STATUSES),
        allowNull: false,
        defaultValue: 'pending'
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
        type: DataTypes.TEXT('long'),
        allowNull: true
      },
      scenePrompt: {
        field: 'scene_prompt',
        type: DataTypes.TEXT('long'),
        allowNull: true
      },
      assetPath: {
        field: 'asset_path',
        type: DataTypes.STRING(500),
        allowNull: true,
        validate: {
          len: [0, 500]
        }
      },
      assetUrl: {
        field: 'asset_url',
        type: DataTypes.STRING(500),
        allowNull: true,
        validate: {
          len: [0, 500]
        }
      },
      sourceSegmentId: {
        field: 'source_segment_id',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
        references: {
          model: 'segments',
          key: 'id'
        }
      },
      representativeFrameTime: {
        field: 'representative_frame_time',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      errorMessage: {
        field: 'error_message',
        type: DataTypes.TEXT,
        allowNull: true
      },
      meta: {
        type: DataTypes.JSON,
        allowNull: true
      }
    },
    {
      tableName: 'background_assets',
      indexes: [
        {
          name: 'background_assets_video_id_idx',
          fields: ['video_id']
        },
        {
          name: 'background_assets_video_background_unique',
          unique: true,
          fields: ['video_id', 'background_id']
        },
        {
          name: 'background_assets_status_idx',
          fields: ['status']
        }
      ]
    }
  );

  BackgroundAsset.associate = ({ Video, Segment }) => {
    if (Video) {
      BackgroundAsset.belongsTo(Video, {
        foreignKey: 'videoId',
        as: 'video',
        onDelete: 'CASCADE'
      });
    }

    if (Segment) {
      BackgroundAsset.belongsTo(Segment, {
        foreignKey: 'sourceSegmentId',
        as: 'sourceSegment',
        onDelete: 'SET NULL'
      });
    }
  };

  return BackgroundAsset;
};

export default defineBackgroundAssetModel;
