import { DataTypes } from 'sequelize';

const RESOURCE_IMAGE_ASSET_STATUSES = ['pending', 'processing', 'completed', 'failed'];
const RESOURCE_IMAGE_TYPES = ['character', 'scene'];

const defineResourceImageAssetModel = (sequelize) => {
  const ResourceImageAsset = sequelize.define(
    'ResourceImageAsset',
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
      resourceType: {
        field: 'resource_type',
        type: DataTypes.ENUM(...RESOURCE_IMAGE_TYPES),
        allowNull: false
      },
      resourceId: {
        field: 'resource_id',
        type: DataTypes.STRING(191),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 191]
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
      variantId: {
        field: 'variant_id',
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 64]
        }
      },
      variantLabel: {
        field: 'variant_label',
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 64]
        }
      },
      sortOrder: {
        field: 'sort_order',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      sourcePrompt: {
        field: 'source_prompt',
        type: DataTypes.TEXT('long'),
        allowNull: true
      },
      prompt: {
        type: DataTypes.TEXT('long'),
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM(...RESOURCE_IMAGE_ASSET_STATUSES),
        allowNull: false,
        defaultValue: 'pending'
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
      mimeType: {
        field: 'mime_type',
        type: DataTypes.STRING(64),
        allowNull: true,
        validate: {
          len: [0, 64]
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
      tableName: 'resource_image_assets',
      indexes: [
        {
          name: 'resource_image_assets_video_id_idx',
          fields: ['video_id']
        },
        {
          name: 'resource_image_assets_video_resource_variant_unique',
          unique: true,
          fields: ['video_id', 'resource_type', 'resource_id', 'variant_id']
        },
        {
          name: 'resource_image_assets_status_idx',
          fields: ['status']
        }
      ]
    }
  );

  ResourceImageAsset.associate = ({ Video }) => {
    if (Video) {
      ResourceImageAsset.belongsTo(Video, {
        foreignKey: 'videoId',
        as: 'video',
        onDelete: 'CASCADE'
      });
    }
  };

  return ResourceImageAsset;
};

export default defineResourceImageAssetModel;
